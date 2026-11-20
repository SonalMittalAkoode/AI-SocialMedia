"""Re-encrypt stored social credentials with the current SOCIAL_TOKEN_ENCRYPTION_KEY.

Rotation procedure (see docs/social-accounts-oauth.md):
  1. Generate a new key:  python -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))"
  2. Set SOCIAL_TOKEN_PREVIOUS_KEYS="<old version>:<old key>" (comma-separate several),
     SOCIAL_TOKEN_ENCRYPTION_KEY=<new key>, SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION=<old version + 1>.
  3. Restart the API, then run this script (dry run first, then --apply).
  4. When it reports 0 credentials on old versions, remove the old key from PREVIOUS_KEYS.

Dry run by default. Prints counts and row IDs only, never tokens, ciphertext or keys.
Each row is locked and re-encrypted in its own transaction; already-current rows are skipped.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import func, select  # noqa: E402

from app.core import token_crypto  # noqa: E402
from app.db.database import SessionLocal  # noqa: E402
from app.models import onboarding, user  # noqa: E402,F401  register referenced tables
from app.models.social_accounts import SocialAccountCredential  # noqa: E402


def rotate(db, apply: bool) -> dict:
    current = token_crypto.current_version()
    ids = db.scalars(select(SocialAccountCredential.id).where(SocialAccountCredential.key_version != current)).all()
    db.rollback()
    done = failed = 0
    for credential_id in ids:
        row = db.scalar(select(SocialAccountCredential).where(SocialAccountCredential.id == credential_id).with_for_update())
        if row is None or row.key_version == current:
            db.rollback()
            continue
        try:
            access = token_crypto.decrypt(row.access_token_ciphertext, row.key_version, row.social_account_id, "access_token")
            refresh = (token_crypto.decrypt(row.refresh_token_ciphertext, row.key_version, row.social_account_id, "refresh_token")
                       if row.refresh_token_ciphertext is not None else None)
        except token_crypto.CredentialCryptoError:
            failed += 1
            print(f"cannot decrypt credential {row.id} (key version {row.key_version} unavailable)")
            db.rollback()
            continue
        if apply:
            version, row.access_token_ciphertext = token_crypto.encrypt(access, row.social_account_id, "access_token")
            if refresh is not None:
                _, row.refresh_token_ciphertext = token_crypto.encrypt(refresh, row.social_account_id, "refresh_token")
            row.key_version = version
            db.commit()
        else:
            db.rollback()
        done += 1
    remaining = db.scalar(select(func.count()).select_from(SocialAccountCredential).where(SocialAccountCredential.key_version != current))
    return {"current_version": current, "eligible": len(ids), "reencrypted" if apply else "would_reencrypt": done,
            "undecryptable": failed, "remaining_on_old_versions": remaining}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write re-encrypted values (default: dry run)")
    args = parser.parse_args()
    with SessionLocal() as session:
        print(rotate(session, args.apply))

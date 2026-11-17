"""Dry-run orphan cleanup. --apply removes only UUID PNG/temp files >24h old
under the configured private root, with no DB reference. Run with workers stopped.
Never removes post records, referenced images, directories or arbitrary files.
"""
import argparse
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select
from app.db.database import SessionLocal
from app.models import onboarding,intelligence,content,user  # register referenced tables
from app.models.content import PostAsset
from app.services.media_storage import LocalMediaStorage
from app.services.extraction_errors import ExtractionError


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    store=LocalMediaStorage();root=store.root.resolve()
    with SessionLocal() as db:referenced=set(db.scalars(select(PostAsset.storage_key)))
    count=0
    if root.exists():
        for folder in root.iterdir():
            if folder.is_symlink() or not folder.is_dir():continue
            for path in folder.iterdir():
                if path.is_symlink() or not path.is_file() or time.time()-path.stat().st_mtime<86400:continue
                key=path.relative_to(root).as_posix()
                if key in referenced:continue
                try:
                    if path.suffix=='.png':checked=store.path(key)
                    elif path.suffix=='.tmp' and len(path.name.split('.'))==3:
                        import re
                        if not re.fullmatch(r'[0-9a-f]{32}',path.name.split('.')[1]):continue
                        checked=store.path(f'{folder.name}/{path.name.split(".")[0]}.png').with_name(path.name)
                    else:continue
                except (ValueError,ExtractionError):continue
                if checked!=path or not checked.resolve().is_relative_to(root):continue
                count+=1
                if args.apply:checked.unlink()
    print({'mode':'apply' if args.apply else 'dry-run','orphan_files':count})


if __name__=='__main__':main()

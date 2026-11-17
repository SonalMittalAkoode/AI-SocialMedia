
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"

if len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET must be at least 32 characters")

ACCESS_TOKEN_MINUTES = 30
COOKIE_NAME = "access_token"
COOKIE_PATH = "/"
COOKIE_SAMESITE = "lax"
PRODUCTION = os.getenv("ENVIRONMENT", "development").lower() == "production"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", str(PRODUCTION)).lower() == "true"
FRONTEND_ORIGINS = tuple(
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
)
TRUSTED_ORIGINS = frozenset(FRONTEND_ORIGINS) | frozenset(
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "API_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
    ).split(",")
    if origin.strip()
)
for origin in TRUSTED_ORIGINS:
    parsed = urlsplit(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path:
        raise RuntimeError("Authentication origins must be explicit HTTP(S) origins")
if PRODUCTION and (not COOKIE_SECURE or any(not o.startswith("https://") for o in TRUSTED_ORIGINS)):
    raise RuntimeError("Production authentication requires Secure cookies and HTTPS origins")

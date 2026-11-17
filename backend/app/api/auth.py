
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.user import User
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    UserResponse,
)
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
)
from app.core.auth_config import (
    JWT_SECRET, JWT_ALGORITHM, ACCESS_TOKEN_MINUTES, COOKIE_NAME, COOKIE_PATH,
    COOKIE_SECURE, COOKIE_SAMESITE, TRUSTED_ORIGINS,
)


router = APIRouter(prefix="/auth", tags=["Authentication"])

# A fixed Argon2 dummy hash keeps unknown-user login on the password-verification path.
DUMMY_PASSWORD_HASH = hash_password("unused-dummy-password-for-timing-only")


def check_origin(request: Request):
    origin = request.headers.get("origin")
    if origin not in TRUSTED_ORIGINS:
        raise HTTPException(status_code=403, detail="Invalid origin")


def current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    token = request.cookies.get(COOKIE_NAME)

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "exp", "iat", "type"]},
        )

        if payload.get("type") != "access":
            raise ValueError("Invalid token type")

        user_id = UUID(payload["sub"])

    except (jwt.PyJWTError, ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(status_code=401, detail="Invalid session")

    try:
        user = db.get(User, user_id)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Authentication is temporarily unavailable") from None

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid session")

    return user


@router.post("/register", response_model=UserResponse, status_code=201)
def register(
    data: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    check_origin(request)
    email = str(data.email).strip().lower()

    response.headers["Cache-Control"] = "no-store"
    try:
        existing = db.scalar(select(User).where(User.email == email))
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Authentication is temporarily unavailable") from None

    if existing:
        raise HTTPException(
            status_code=409,
            detail="Email already registered",
        )

    user = User(
        full_name=data.full_name.strip(),
        email=email,
        hashed_password=hash_password(data.password),
    )

    db.add(user)

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already registered") from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Registration is temporarily unavailable") from None

    return user


@router.post("/login", response_model=UserResponse)
def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    check_origin(request)
    email = str(data.email).strip().lower()

    response.headers["Cache-Control"] = "no-store"
    try:
        user = db.scalar(select(User).where(User.email == email))
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Authentication is temporarily unavailable") from None

    password_valid = verify_password(data.password, user.hashed_password if user else DUMMY_PASSWORD_HASH)
    if not user or not password_valid:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token(user.id)

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=ACCESS_TOKEN_MINUTES * 60 if data.remember_me else None,
        path=COOKIE_PATH,
    )

    return user


@router.get("/me", response_model=UserResponse)
def me(response: Response, user: User = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return user


@router.post("/logout")
def logout(request: Request, response: Response):
    check_origin(request)
    response.delete_cookie(
        key=COOKIE_NAME,
        path=COOKIE_PATH,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        httponly=True,
    )
    response.headers["Cache-Control"] = "no-store"
    return {"message": "Logged out"}

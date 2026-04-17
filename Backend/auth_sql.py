from __future__ import annotations

import os
import hmac
import hashlib
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session as DBSession

from database import SessionLocal
from models import User, SessionToken


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

AUTH_SECRET = os.getenv("AUTH_SECRET", "dev-only-change-this-secret")
AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "spnc_session")
AUTH_COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true"
AUTH_COOKIE_SAMESITE = os.getenv("AUTH_COOKIE_SAMESITE", "lax")
AUTH_SESSION_DAYS = int(os.getenv("AUTH_SESSION_DAYS", "7"))
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").lower() == "true"

router = APIRouter(prefix="/auth", tags=["auth"])


# -----------------------------
# DB dependency
# -----------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# -----------------------------
# Pydantic models
# -----------------------------
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthUserResponse(BaseModel):
    id: int
    email: str
    role: str
    school_domain: Optional[str] = None


class AuthMeResponse(BaseModel):
    authenticated: bool
    auth_required: bool
    user: Optional[AuthUserResponse] = None


# -----------------------------
# Password hashing
# -----------------------------
def hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        120_000,
    )
    return f"{salt}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, _expected = stored_hash.split("$", 1)
    except ValueError:
        return False

    test_hash = hash_password(password, salt)
    return hmac.compare_digest(test_hash, stored_hash)


# -----------------------------
# Session token helpers
# -----------------------------
def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def make_session_token() -> str:
    return secrets.token_urlsafe(32)


def now_utc() -> datetime:
    return datetime.utcnow()


# -----------------------------
# DB helpers
# -----------------------------
def user_to_public_dict(user: User) -> Dict[str, Any]:
    return {
        "id": int(user.id),
        "email": user.email,
        "role": user.role,
        "school_domain": user.school_domain,
    }


def get_user_by_email(db: DBSession, email: str) -> Optional[User]:
    return (
        db.query(User)
        .filter(User.email == email.strip().lower())
        .first()
    )


def get_user_by_id(db: DBSession, user_id: int) -> Optional[User]:
    return db.query(User).filter(User.id == int(user_id)).first()


def create_user(db: DBSession, email: str, password: str, role: str = "student") -> Dict[str, Any]:
    email = email.strip().lower()

    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")

    existing = get_user_by_email(db, email)
    if existing:
        raise HTTPException(status_code=400, detail="Account already exists")

    school_domain = email.split("@", 1)[1] if "@" in email else None
    password_hash = hash_password(password)
    now = now_utc()

    user = User(
        email=email,
        password_hash=password_hash,
        role=role,
        school_domain=school_domain,
        created_at=now.isoformat(timespec="seconds"),
        updated_at=now.isoformat(timespec="seconds"),
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user_to_public_dict(user)


def create_session(db: DBSession, user_id: int) -> str:
    raw_token = make_session_token()
    token_hash = hash_session_token(raw_token)
    created_at = now_utc()
    expires_at = created_at + timedelta(days=AUTH_SESSION_DAYS)

    session_row = SessionToken(
        user_id=int(user_id),
        session_token_hash=token_hash,
        created_at=created_at.isoformat(timespec="seconds"),
        expires_at=expires_at.isoformat(timespec="seconds"),
        revoked_at=None,
    )

    db.add(session_row)
    db.commit()

    return raw_token


def revoke_session(db: DBSession, raw_token: str) -> None:
    token_hash = hash_session_token(raw_token)

    session_row = (
        db.query(SessionToken)
        .filter(
            SessionToken.session_token_hash == token_hash,
            SessionToken.revoked_at.is_(None),
        )
        .first()
    )

    if session_row:
        session_row.revoked_at = now_utc().isoformat(timespec="seconds")
        db.commit()


def get_user_from_session_token(db: DBSession, raw_token: str) -> Optional[Dict[str, Any]]:
    if not raw_token:
        return None

    token_hash = hash_session_token(raw_token)

    session_row = (
        db.query(SessionToken)
        .filter(SessionToken.session_token_hash == token_hash)
        .first()
    )

    if not session_row:
        return None

    if session_row.revoked_at:
        return None

    expires_at = session_row.expires_at
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)

    if expires_at < now_utc():
        return None

    user = (
        db.query(User)
        .filter(User.id == session_row.user_id)
        .first()
    )

    if not user:
        return None

    return user_to_public_dict(user)


# -----------------------------
# Cookie helpers
# -----------------------------
def set_auth_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite=AUTH_COOKIE_SAMESITE,
        max_age=AUTH_SESSION_DAYS * 24 * 60 * 60,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        path="/",
    )


# -----------------------------
# Dependencies
# -----------------------------
def get_current_user_optional(
    request: Request,
    db: DBSession = Depends(get_db),
) -> Optional[Dict[str, Any]]:
    raw_token = request.cookies.get(AUTH_COOKIE_NAME)
    if not raw_token:
        return None
    return get_user_from_session_token(db, raw_token)


def get_current_user_required(
    request: Request,
    db: DBSession = Depends(get_db),
) -> Dict[str, Any]:
    raw_token = request.cookies.get(AUTH_COOKIE_NAME)
    user = get_user_from_session_token(db, raw_token) if raw_token else None

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    return user


def require_admin(
    current_user: Dict[str, Any] = Depends(get_current_user_required),
) -> Dict[str, Any]:
    if (current_user.get("role") or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# -----------------------------
# Routes
# -----------------------------
@router.get("/me", response_model=AuthMeResponse)
def auth_me(
    request: Request,
    db: DBSession = Depends(get_db),
):
    user = get_current_user_optional(request, db)

    if not user:
        return AuthMeResponse(
            authenticated=False,
            auth_required=AUTH_REQUIRED,
            user=None,
        )

    return AuthMeResponse(
        authenticated=True,
        auth_required=AUTH_REQUIRED,
        user=AuthUserResponse(**user),
    )


@router.post("/register", response_model=AuthUserResponse)
def register(
    payload: RegisterRequest,
    response: Response,
    db: DBSession = Depends(get_db),
):
    user = create_user(db, payload.email, payload.password, role="student")
    raw_token = create_session(db, int(user["id"]))
    set_auth_cookie(response, raw_token)
    return AuthUserResponse(**user)


@router.post("/login", response_model=AuthUserResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: DBSession = Depends(get_db),
):
    user = get_user_by_email(db, payload.email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    public_user = user_to_public_dict(user)

    raw_token = create_session(db, int(user.id))
    set_auth_cookie(response, raw_token)
    return AuthUserResponse(**public_user)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: DBSession = Depends(get_db),
):
    raw_token = request.cookies.get(AUTH_COOKIE_NAME)
    if raw_token:
        revoke_session(db, raw_token)

    clear_auth_cookie(response)
    return {"status": "ok"}
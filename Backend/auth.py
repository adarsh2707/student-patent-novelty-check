from __future__ import annotations

import os
import hmac
import json
import base64
import sqlite3
import hashlib
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DB_PATH = BASE_DIR / "search_logs.db"

AUTH_SECRET = os.getenv("AUTH_SECRET", "dev-only-change-this-secret")
AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "spnc_session")
AUTH_COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true"
AUTH_COOKIE_SAMESITE = os.getenv("AUTH_COOKIE_SAMESITE", "lax")
AUTH_SESSION_DAYS = int(os.getenv("AUTH_SESSION_DAYS", "7"))
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").lower() == "true"

router = APIRouter(prefix="/auth", tags=["auth"])


# -----------------------------
# DB init
# -----------------------------
def init_auth_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()

        cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL DEFAULT 'student',
                        school_domain TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                session_token_hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )

        conn.commit()
    finally:
        conn.close()


init_auth_db()


# -----------------------------
# Models
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
        salt, expected = stored_hash.split("$", 1)
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


def iso_dt(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


# -----------------------------
# DB helpers
# -----------------------------
def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, email, password_hash, role, school_domain, created_at
            FROM users
            WHERE lower(email) = lower(?)
            LIMIT 1
            """,
            (email.strip(),),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, email, role, school_domain, created_at
            FROM users
            WHERE id = ?
            LIMIT 1
            """,
            (int(user_id),),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_user(email: str, password: str, role: str = "student") -> Dict[str, Any]:
    email = email.strip().lower()

    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")

    existing = get_user_by_email(email)
    if existing:
        raise HTTPException(status_code=400, detail="Account already exists")

    school_domain = email.split("@", 1)[1] if "@" in email else None
    password_hash = hash_password(password)
    now_str = iso_dt(now_utc())

    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO users (
                email,
                password_hash,
                role,
                school_domain,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                email,
                password_hash,
                role,
                school_domain,
                now_str,
                now_str,
            ),
        )
        conn.commit()
        user_id = cur.lastrowid
    finally:
        conn.close()

    user = get_user_by_id(int(user_id))
    if not user:
        raise HTTPException(status_code=500, detail="User creation failed")
    return user


def create_session(user_id: int) -> str:
    raw_token = make_session_token()
    token_hash = hash_session_token(raw_token)
    created_at = now_utc()
    expires_at = created_at + timedelta(days=AUTH_SESSION_DAYS)

    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO sessions (
                user_id,
                session_token_hash,
                created_at,
                expires_at,
                revoked_at
            ) VALUES (?, ?, ?, ?, NULL)
            """,
            (
                int(user_id),
                token_hash,
                iso_dt(created_at),
                iso_dt(expires_at),
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return raw_token


def revoke_session(raw_token: str) -> None:
    token_hash = hash_session_token(raw_token)

    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE sessions
            SET revoked_at = ?
            WHERE session_token_hash = ? AND revoked_at IS NULL
            """,
            (iso_dt(now_utc()), token_hash),
        )
        conn.commit()
    finally:
        conn.close()


def get_user_from_session_token(raw_token: str) -> Optional[Dict[str, Any]]:
    if not raw_token:
        return None

    token_hash = hash_session_token(raw_token)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                u.id,
                u.email,
                u.role,
                u.school_domain,
                s.expires_at,
                s.revoked_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.session_token_hash = ?
            LIMIT 1
            """,
            (token_hash,),
        )
        row = cur.fetchone()
        if not row:
            return None

        data = dict(row)

        if data.get("revoked_at"):
            return None

        expires_at = datetime.fromisoformat(data["expires_at"])
        if expires_at < now_utc():
            return None

        return {
            "id": data["id"],
            "email": data["email"],
            "role": data["role"],
            "school_domain": data.get("school_domain"),
        }
    finally:
        conn.close()


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
def get_current_user_optional(request: Request) -> Optional[Dict[str, Any]]:
    raw_token = request.cookies.get(AUTH_COOKIE_NAME)
    if not raw_token:
        return None
    return get_user_from_session_token(raw_token)


def get_current_user_required(
    request: Request,
) -> Dict[str, Any]:
    user = get_current_user_optional(request)
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
def auth_me(request: Request):
    user = get_current_user_optional(request)

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
def register(payload: RegisterRequest, response: Response):
    user = create_user(payload.email, payload.password, role="student")
    raw_token = create_session(int(user["id"]))
    set_auth_cookie(response, raw_token)
    return AuthUserResponse(**user)


@router.post("/login", response_model=AuthUserResponse)
def login(payload: LoginRequest, response: Response):
    user = get_user_by_email(payload.email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    public_user = {
        "id": int(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "school_domain": user.get("school_domain"),
    }

    raw_token = create_session(int(user["id"]))
    set_auth_cookie(response, raw_token)
    return AuthUserResponse(**public_user)


@router.post("/logout")
def logout(request: Request, response: Response):
    raw_token = request.cookies.get(AUTH_COOKIE_NAME)
    if raw_token:
        revoke_session(raw_token)

    clear_auth_cookie(response)
    return {"status": "ok"}
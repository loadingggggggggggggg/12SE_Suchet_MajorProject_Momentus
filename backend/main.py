from __future__ import annotations

import hashlib
import json
import os
import secrets
import smtplib
import sqlite3
import ssl
import time
import uuid
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from argon2.low_level import Type
from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.gemini_service import (
    ALLOWED_MODES,
    GeminiConfigurationError,
    GeminiServiceError,
    analyse_with_gemini,
)
from backend.services import AnalyticsService, StoreRepository


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR.parent / "web"
DB_PATH = BASE_DIR / "momentus.db"

SESSION_COOKIE = "momentus_session"
CSRF_COOKIE = "momentus_csrf"
SESSION_TTL = timedelta(days=14)
PASSWORD_RESET_TTL = timedelta(hours=1)
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 15 * 60
PASSWORD_HASHER = PasswordHasher(type=Type.ID, time_cost=3, memory_cost=65536, parallelism=4)

ALLOWED_STORES = {
    "sessions",
    "workoutSets",
    "hydration",
    "habits",
    "macros",
    "meals",
    "foods",
    "sleep",
    "recoveryNotes",
    "settings",
}

ONBOARDING_STATUSES = {"pending", "skipped", "completed"}
FAILED_LOGIN_ATTEMPTS: dict[str, list[float]] = {}

app = FastAPI(title="Momentus API")


class SignupPayload(BaseModel):
    displayName: str = Field(min_length=1, max_length=80)
    email: str
    password: str


class LoginPayload(BaseModel):
    email: str
    password: str


class ChangePasswordPayload(BaseModel):
    currentPassword: str
    newPassword: str


class ForgotPasswordPayload(BaseModel):
    email: str


class ResetPasswordPayload(BaseModel):
    token: str
    newPassword: str


class ProfilePayload(BaseModel):
    displayName: str = Field(min_length=1, max_length=80)
    email: str


class OnboardingPayload(BaseModel):
    status: str = "pending"
    currentStep: int = 0
    answers: dict[str, Any] = Field(default_factory=dict)
    version: int = 1


class WeekSummaryPayload(BaseModel):
    weekDates: list[str]


class AiImagePayload(BaseModel):
    mimeType: str
    data: str = Field(max_length=8_000_000)


class AiAnalysisPayload(BaseModel):
    mode: str
    text: str = Field(default="", max_length=12000)
    context: dict[str, Any] = Field(default_factory=dict)
    images: list[AiImagePayload] = Field(default_factory=list)


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).isoformat()


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def ensure_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        _migrate_legacy_items_table(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL UNIQUE COLLATE NOCASE,
              display_name TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              onboarding_status TEXT NOT NULL DEFAULT 'pending',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_login_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_sessions (
              token_hash TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              last_seen_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
              token_hash TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS onboarding_profiles (
              user_id TEXT PRIMARY KEY,
              answers_json TEXT NOT NULL DEFAULT '{}',
              current_step INTEGER NOT NULL DEFAULT 0,
              completed_at TEXT,
              skipped_at TEXT,
              version INTEGER NOT NULL DEFAULT 1,
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
              user_id TEXT NOT NULL,
              store TEXT NOT NULL,
              id TEXT NOT NULL,
              data TEXT NOT NULL,
              PRIMARY KEY (user_id, store, id),
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_user_store ON items(user_id, store)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id)")
        conn.commit()


def _migrate_legacy_items_table(conn: sqlite3.Connection) -> None:
    table = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'"
    ).fetchone()
    if not table:
        return
    columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(items)").fetchall()
        if row["name"]
    }
    if "user_id" in columns:
        return
    legacy_name = f"items_legacy_{int(time.time())}"
    conn.execute(f'ALTER TABLE items RENAME TO "{legacy_name}"')


def get_conn() -> sqlite3.Connection:
    ensure_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_repository() -> StoreRepository:
    ensure_db()
    return StoreRepository(str(DB_PATH))


def validate_store(store: str) -> str:
    if store not in ALLOWED_STORES:
        raise HTTPException(status_code=404, detail="Unknown store")
    return store


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalize_email(email: str) -> str:
    value = (email or "").strip().lower()
    if not value or "@" not in value or value.startswith("@") or value.endswith("@"):
        raise HTTPException(status_code=422, detail="A valid email is required")
    return value


def validate_password(password: str) -> str:
    candidate = password or ""
    if len(candidate) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    if len(candidate) > 128:
        raise HTTPException(status_code=422, detail="Password is too long")
    if not any(ch.isalpha() for ch in candidate) or not any(ch.isdigit() for ch in candidate):
        raise HTTPException(status_code=422, detail="Password must include letters and numbers")
    return candidate


def normalize_display_name(name: str) -> str:
    cleaned = " ".join(str(name or "").split())
    if not cleaned:
        raise HTTPException(status_code=422, detail="Display name is required")
    return cleaned[:80]


def default_settings() -> list[dict[str, Any]]:
    return [
        {
            "id": "macroTargets",
            "calories": 0,
            "protein": 0,
            "carbs": 0,
            "fat": 0,
            "hydration": 0,
        }
    ]


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int | None = None) -> int | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return None


def get_public_base_url(request: Request) -> str:
    configured = os.getenv("MOMENTUS_PUBLIC_BASE_URL", "").strip()
    if configured:
        return configured.rstrip("/")
    return str(request.base_url).rstrip("/")


def is_local_request(request: Request) -> bool:
    host = (request.url.hostname or "").strip().lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def allow_dev_password_reset_link(request: Request) -> bool:
    if env_flag("MOMENTUS_ALLOW_DEV_RESET_LINKS", False):
        return True
    return is_local_request(request)


def get_password_reset_email_settings() -> dict[str, Any]:
    username = os.getenv("MOMENTUS_SMTP_USERNAME", "").strip()
    return {
        "host": os.getenv("MOMENTUS_SMTP_HOST", "").strip(),
        "port": env_int("MOMENTUS_SMTP_PORT", 587),
        "username": username,
        "password": os.getenv("MOMENTUS_SMTP_PASSWORD", ""),
        "from": (os.getenv("MOMENTUS_SMTP_FROM", "").strip() or username),
        "use_tls": env_flag("MOMENTUS_SMTP_USE_TLS", True),
        "use_ssl": env_flag("MOMENTUS_SMTP_USE_SSL", False),
    }


def password_reset_email_is_configured() -> bool:
    settings = get_password_reset_email_settings()
    return bool(settings["host"] and settings["from"] and settings["port"])


def build_password_reset_url(request: Request, token: str) -> str:
    return f"{get_public_base_url(request)}/reset-password?{urlencode({'token': token})}"


def cleanup_expired_password_reset_tokens(conn: sqlite3.Connection) -> None:
    conn.execute(
        "DELETE FROM password_reset_tokens WHERE expires_at <= ?",
        (utc_iso(utc_now()),),
    )


def issue_password_reset_token(conn: sqlite3.Connection, user_id: str) -> str:
    cleanup_expired_password_reset_tokens(conn)
    conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (user_id,))
    token = secrets.token_urlsafe(32)
    now = utc_now()
    expires_at = now + PASSWORD_RESET_TTL
    conn.execute(
        """
        INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (hash_password_reset_token(token), user_id, utc_iso(expires_at), utc_iso(now)),
    )
    return token


def send_password_reset_email(recipient_email: str, reset_url: str) -> None:
    settings = get_password_reset_email_settings()
    message = EmailMessage()
    message["Subject"] = "Reset your Momentus password"
    message["From"] = settings["from"]
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                "A password reset was requested for your Momentus account.",
                "",
                f"Reset your password: {reset_url}",
                "",
                "This link expires in 1 hour. If you did not request this, you can ignore this email.",
            ]
        )
    )

    context = ssl.create_default_context()
    if settings["use_ssl"]:
        with smtplib.SMTP_SSL(settings["host"], settings["port"], context=context, timeout=15) as server:
            if settings["username"]:
                server.login(settings["username"], settings["password"])
            server.send_message(message)
        return

    with smtplib.SMTP(settings["host"], settings["port"], timeout=15) as server:
        if settings["use_tls"]:
            server.starttls(context=context)
        if settings["username"]:
            server.login(settings["username"], settings["password"])
        server.send_message(message)


def serialize_user(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": data["id"],
        "email": data["email"],
        "displayName": data["display_name"],
        "onboardingStatus": data.get("onboarding_status", "pending"),
    }


def serialize_onboarding(row: sqlite3.Row, status: str) -> dict[str, Any]:
    answers: dict[str, Any]
    try:
        answers = json.loads(row["answers_json"] or "{}")
        if not isinstance(answers, dict):
            answers = {}
    except json.JSONDecodeError:
        answers = {}
    return {
        "status": status or "pending",
        "currentStep": max(0, int(row["current_step"] or 0)),
        "answers": answers,
        "version": max(1, int(row["version"] or 1)),
    }


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def get_failed_login_key(request: Request, email: str) -> str:
    return f"{get_client_ip(request)}::{normalize_email(email)}"


def _prune_failed_logins(now: float) -> None:
    expired = []
    for key, attempts in FAILED_LOGIN_ATTEMPTS.items():
        filtered = [stamp for stamp in attempts if now - stamp < LOGIN_WINDOW_SECONDS]
        if filtered:
            FAILED_LOGIN_ATTEMPTS[key] = filtered
        else:
            expired.append(key)
    for key in expired:
        FAILED_LOGIN_ATTEMPTS.pop(key, None)


def is_login_throttled(key: str) -> bool:
    now = time.time()
    _prune_failed_logins(now)
    return len(FAILED_LOGIN_ATTEMPTS.get(key, [])) >= MAX_LOGIN_ATTEMPTS


def record_failed_login(key: str) -> None:
    now = time.time()
    _prune_failed_logins(now)
    FAILED_LOGIN_ATTEMPTS.setdefault(key, []).append(now)


def clear_failed_login(key: str) -> None:
    FAILED_LOGIN_ATTEMPTS.pop(key, None)


def is_secure_request(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return forwarded_proto == "https"


def set_auth_cookies(response: Response, request: Request, session_token: str, csrf_token: str, expires_at: datetime) -> None:
    max_age = int(SESSION_TTL.total_seconds())
    secure = is_secure_request(request)
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
        max_age=max_age,
        expires=expires_at,
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
        max_age=max_age,
        expires=expires_at,
    )


def clear_auth_cookies(response: Response, request: Request) -> None:
    secure = is_secure_request(request)
    response.delete_cookie(SESSION_COOKIE, path="/", samesite="lax", secure=secure, httponly=True)
    response.delete_cookie(CSRF_COOKIE, path="/", samesite="lax", secure=secure, httponly=False)


def issue_session(conn: sqlite3.Connection, user_id: str) -> tuple[str, str, datetime]:
    session_token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(24)
    now = utc_now()
    expires_at = now + SESSION_TTL
    conn.execute(
        """
        INSERT INTO auth_sessions (token_hash, user_id, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?)
        """,
        (hash_session_token(session_token), user_id, utc_iso(expires_at), utc_iso(now)),
    )
    return session_token, csrf_token, expires_at


def fetch_user_by_email(conn: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT id, email, display_name, password_hash, onboarding_status, created_at, updated_at, last_login_at
        FROM users
        WHERE email = ?
        """,
        (email,),
    ).fetchone()


def fetch_user_by_id(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT id, email, display_name, password_hash, onboarding_status, created_at, updated_at, last_login_at
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()


def ensure_onboarding_profile(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT user_id, answers_json, current_step, completed_at, skipped_at, version
        FROM onboarding_profiles
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    if row:
        return row
    conn.execute(
        """
        INSERT INTO onboarding_profiles (user_id, answers_json, current_step, version)
        VALUES (?, ?, ?, ?)
        """,
        (user_id, "{}", 0, 1),
    )
    return conn.execute(
        """
        SELECT user_id, answers_json, current_step, completed_at, skipped_at, version
        FROM onboarding_profiles
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return PASSWORD_HASHER.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def apply_session_to_response(request: Request, response: Response) -> None:
    session_token = getattr(request.state, "session_token", None)
    csrf_token = getattr(request.state, "csrf_token", None)
    expires_at = getattr(request.state, "session_expires_at", None)
    if session_token and csrf_token and expires_at:
        set_auth_cookies(response, request, session_token, csrf_token, expires_at)


def require_authenticated_user(request: Request, response: Response) -> dict[str, Any]:
    raw_session = request.cookies.get(SESSION_COOKIE)
    if not raw_session:
        raise HTTPException(status_code=401, detail="Authentication required")

    session_hash = hash_session_token(raw_session)
    now = utc_now()
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT
              s.token_hash,
              s.user_id,
              s.expires_at,
              u.id,
              u.email,
              u.display_name,
              u.password_hash,
              u.onboarding_status,
              u.created_at,
              u.updated_at,
              u.last_login_at
            FROM auth_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
            """,
            (session_hash,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Authentication required")

        expires_at = parse_utc(row["expires_at"])
        if expires_at is None or expires_at <= now:
            conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (session_hash,))
            raise HTTPException(status_code=401, detail="Authentication required")

        rolled_expiry = now + SESSION_TTL
        conn.execute(
            """
            UPDATE auth_sessions
            SET expires_at = ?, last_seen_at = ?
            WHERE token_hash = ?
            """,
            (utc_iso(rolled_expiry), utc_iso(now), session_hash),
        )

    csrf_token = request.cookies.get(CSRF_COOKIE) or secrets.token_urlsafe(24)
    request.state.session_hash = session_hash
    request.state.session_token = raw_session
    request.state.csrf_token = csrf_token
    request.state.session_expires_at = rolled_expiry

    user = serialize_user(row)
    request.state.current_user = user
    set_auth_cookies(response, request, raw_session, csrf_token, rolled_expiry)
    return user


def require_csrf(request: Request) -> None:
    cookie_token = request.cookies.get(CSRF_COOKIE)
    header_token = request.headers.get("X-CSRF-Token")
    if not cookie_token or not header_token or not secrets.compare_digest(cookie_token, header_token):
        raise HTTPException(status_code=403, detail="Invalid CSRF token")


def get_analytics_for_user(user_id: str) -> AnalyticsService:
    return AnalyticsService(get_repository(), user_id)


@app.on_event("startup")
def on_startup() -> None:
    ensure_db()


@app.get("/")
def landing_page() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/login")
def login_page() -> FileResponse:
    return FileResponse(WEB_DIR / "login.html")


@app.get("/signup")
def signup_page() -> FileResponse:
    return FileResponse(WEB_DIR / "signup.html")


@app.get("/reset-password")
def reset_password_page() -> FileResponse:
    return FileResponse(WEB_DIR / "reset-password.html")


@app.get("/onboarding")
def onboarding_page() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/app")
def app_page() -> FileResponse:
    return FileResponse(WEB_DIR / "app.html")


@app.get("/manifest.webmanifest")
def manifest() -> FileResponse:
    return FileResponse(WEB_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker() -> FileResponse:
    return FileResponse(WEB_DIR / "sw.js", media_type="application/javascript")


@app.post("/api/auth/signup")
def signup(payload: SignupPayload, request: Request, response: Response) -> dict[str, Any]:
    email = normalize_email(payload.email)
    display_name = normalize_display_name(payload.displayName)
    password = validate_password(payload.password)
    now = utc_now()
    user_id = str(uuid.uuid4())

    with get_conn() as conn:
        existing = fetch_user_by_email(conn, email)
        if existing:
            raise HTTPException(status_code=409, detail="An account with that email already exists")

        conn.execute(
            """
            INSERT INTO users (id, email, display_name, password_hash, onboarding_status, created_at, updated_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                email,
                display_name,
                PASSWORD_HASHER.hash(password),
                "pending",
                utc_iso(now),
                utc_iso(now),
                utc_iso(now),
            ),
        )
        conn.execute(
            """
            INSERT INTO onboarding_profiles (user_id, answers_json, current_step, version)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, "{}", 0, 1),
        )
        for item in default_settings():
            conn.execute(
                """
                INSERT INTO items (user_id, store, id, data)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, store, id) DO UPDATE SET data = excluded.data
                """,
                (user_id, "settings", item["id"], json.dumps(item)),
            )
        session_token, csrf_token, expires_at = issue_session(conn, user_id)
        user_row = fetch_user_by_id(conn, user_id)

    set_auth_cookies(response, request, session_token, csrf_token, expires_at)
    return {"user": serialize_user(user_row)}


@app.post("/api/auth/login")
def login(payload: LoginPayload, request: Request, response: Response) -> dict[str, Any]:
    email = normalize_email(payload.email)
    throttle_key = get_failed_login_key(request, email)
    if is_login_throttled(throttle_key):
        raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")

    with get_conn() as conn:
        user_row = fetch_user_by_email(conn, email)
        if not user_row or not verify_password(payload.password, user_row["password_hash"]):
            record_failed_login(throttle_key)
            raise HTTPException(status_code=401, detail="Invalid email or password")

        clear_failed_login(throttle_key)
        now = utc_now()
        conn.execute(
            """
            UPDATE users
            SET last_login_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (utc_iso(now), utc_iso(now), user_row["id"]),
        )
        session_token, csrf_token, expires_at = issue_session(conn, user_row["id"])
        fresh_user_row = fetch_user_by_id(conn, user_row["id"])

    set_auth_cookies(response, request, session_token, csrf_token, expires_at)
    return {"user": serialize_user(fresh_user_row)}


@app.post("/api/auth/forgot-password")
def forgot_password(payload: ForgotPasswordPayload, request: Request) -> dict[str, Any]:
    email = normalize_email(payload.email)
    email_configured = password_reset_email_is_configured()
    if not email_configured and not allow_dev_password_reset_link(request):
        raise HTTPException(status_code=503, detail="Password reset email is not configured on this server yet")

    with get_conn() as conn:
        cleanup_expired_password_reset_tokens(conn)
        user_row = fetch_user_by_email(conn, email)
        if user_row:
            reset_token = issue_password_reset_token(conn, user_row["id"])
            reset_url = build_password_reset_url(request, reset_token)
            if email_configured:
                try:
                    send_password_reset_email(email, reset_url)
                except (OSError, smtplib.SMTPException) as error:
                    raise HTTPException(status_code=503, detail="Could not send reset email right now") from error
            else:
                print(f"[Momentus] Local password reset link for {email}: {reset_url}")
                return {
                    "message": "Email is not configured locally, so a development reset link is ready below.",
                    "devResetUrl": reset_url,
                }

    return {"message": "If that email exists, a password reset link has been sent."}


@app.post("/api/auth/logout")
def logout(
    request: Request,
    response: Response,
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> Response:
    session_hash = getattr(request.state, "session_hash", None)
    if session_hash:
        with get_conn() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (session_hash,))
    clear_auth_cookies(response, request)
    response.status_code = 204
    return response


@app.get("/api/auth/me")
def auth_me(current_user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    return current_user


@app.post("/api/auth/change-password")
def change_password(
    payload: ChangePasswordPayload,
    request: Request,
    response: Response,
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> dict[str, Any]:
    new_password = validate_password(payload.newPassword)
    with get_conn() as conn:
        user_row = fetch_user_by_id(conn, current_user["id"])
        if not user_row or not verify_password(payload.currentPassword, user_row["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        now = utc_now()
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?, updated_at = ?
            WHERE id = ?
            """,
            (PASSWORD_HASHER.hash(new_password), utc_iso(now), current_user["id"]),
        )
        conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (current_user["id"],))
        conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (current_user["id"],))
        session_token, csrf_token, expires_at = issue_session(conn, current_user["id"])
        fresh_user = fetch_user_by_id(conn, current_user["id"])

    set_auth_cookies(response, request, session_token, csrf_token, expires_at)
    return {"user": serialize_user(fresh_user)}


@app.post("/api/auth/reset-password")
def reset_password(payload: ResetPasswordPayload) -> dict[str, str]:
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=422, detail="Reset token is required")
    new_password = validate_password(payload.newPassword)
    token_hash = hash_password_reset_token(token)

    with get_conn() as conn:
        cleanup_expired_password_reset_tokens(conn)
        reset_row = conn.execute(
            """
            SELECT token_hash, user_id, expires_at
            FROM password_reset_tokens
            WHERE token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if not reset_row:
            raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")

        expires_at = parse_utc(reset_row["expires_at"])
        if expires_at is None or expires_at <= utc_now():
            conn.execute("DELETE FROM password_reset_tokens WHERE token_hash = ?", (token_hash,))
            raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")

        now = utc_now()
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?, updated_at = ?
            WHERE id = ?
            """,
            (PASSWORD_HASHER.hash(new_password), utc_iso(now), reset_row["user_id"]),
        )
        conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (reset_row["user_id"],))
        conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (reset_row["user_id"],))

    return {"message": "Your password has been reset. You can log in with your new password now."}


@app.get("/api/account/profile")
def get_profile(current_user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    return current_user


@app.put("/api/account/profile")
def update_profile(
    payload: ProfilePayload,
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> dict[str, Any]:
    display_name = normalize_display_name(payload.displayName)
    email = normalize_email(payload.email)
    now = utc_now()

    with get_conn() as conn:
        existing = fetch_user_by_email(conn, email)
        if existing and existing["id"] != current_user["id"]:
            raise HTTPException(status_code=409, detail="An account with that email already exists")
        conn.execute(
            """
            UPDATE users
            SET display_name = ?, email = ?, updated_at = ?
            WHERE id = ?
            """,
            (display_name, email, utc_iso(now), current_user["id"]),
        )
        user_row = fetch_user_by_id(conn, current_user["id"])

    return serialize_user(user_row)


@app.get("/api/account/onboarding")
def get_onboarding(current_user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    with get_conn() as conn:
        row = ensure_onboarding_profile(conn, current_user["id"])
        user_row = fetch_user_by_id(conn, current_user["id"])
    return serialize_onboarding(row, user_row["onboarding_status"] if user_row else "pending")


@app.put("/api/account/onboarding")
def update_onboarding(
    payload: OnboardingPayload,
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> dict[str, Any]:
    status = payload.status if payload.status in ONBOARDING_STATUSES else "pending"
    current_step = max(0, int(payload.currentStep or 0))
    version = max(1, int(payload.version or 1))
    answers = payload.answers if isinstance(payload.answers, dict) else {}
    now_iso = utc_iso(utc_now())

    completed_at = now_iso if status == "completed" else None
    skipped_at = now_iso if status == "skipped" else None

    with get_conn() as conn:
        ensure_onboarding_profile(conn, current_user["id"])
        conn.execute(
            """
            UPDATE onboarding_profiles
            SET answers_json = ?, current_step = ?, completed_at = ?, skipped_at = ?, version = ?
            WHERE user_id = ?
            """,
            (json.dumps(answers), current_step, completed_at, skipped_at, version, current_user["id"]),
        )
        conn.execute(
            """
            UPDATE users
            SET onboarding_status = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, now_iso, current_user["id"]),
        )
        row = ensure_onboarding_profile(conn, current_user["id"])

    return serialize_onboarding(row, status)


@app.get("/api/account/export")
def export_account_data(
    request: Request,
    current_user: dict[str, Any] = Depends(require_authenticated_user),
) -> Response:
    repository = get_repository()
    with get_conn() as conn:
        onboarding_row = ensure_onboarding_profile(conn, current_user["id"])
        user_row = fetch_user_by_id(conn, current_user["id"])

    payload = {
        "profile": serialize_user(user_row),
        "onboarding": serialize_onboarding(onboarding_row, user_row["onboarding_status"]),
        "stores": repository.export_user_data(current_user["id"], sorted(ALLOWED_STORES)),
    }
    filename = f"momentus-export-{datetime.now().strftime('%Y%m%d')}.json"
    response = Response(content=json.dumps(payload), media_type="application/json")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    apply_session_to_response(request, response)
    return response


@app.get("/api/analytics/session-metrics")
def analytics_session_metrics(days: int = 7, current_user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    return get_analytics_for_user(current_user["id"]).compute_session_metrics(days)


@app.get("/api/analytics/volume-by-muscle")
def analytics_volume_by_muscle(
    days: int | None = None,
    range: str | None = None,
    date: str | None = None,
    current_user: dict[str, Any] = Depends(require_authenticated_user),
) -> dict[str, Any]:
    analytics = get_analytics_for_user(current_user["id"])
    if range and date:
        return analytics.compute_volume_by_muscle_range(range, date)
    window = days if days is not None else 7
    return analytics.compute_volume_by_muscle(window)


@app.post("/api/analytics/week-summary")
def analytics_week_summary(
    payload: WeekSummaryPayload,
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> dict[str, Any]:
    return get_analytics_for_user(current_user["id"]).compute_week_summary(payload.weekDates)


@app.get("/api/analytics/macro-progress")
def analytics_macro_progress(date: str, current_user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    return get_analytics_for_user(current_user["id"]).compute_macro_progress(date)


@app.get("/api/analytics/hydration-total")
def analytics_hydration_total(date: str, current_user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    return get_analytics_for_user(current_user["id"]).compute_hydration_total(date)


@app.get("/api/analytics/recovery-timeline")
def analytics_recovery_timeline(limit: int = 30, current_user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    entries = get_analytics_for_user(current_user["id"]).build_recovery_timeline(limit)
    return {"entries": entries}


@app.post("/api/ai/analyse")
def ai_analyse(
    payload: AiAnalysisPayload,
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> dict[str, Any]:
    mode = (payload.mode or "").strip()
    if mode not in ALLOWED_MODES:
        raise HTTPException(status_code=422, detail="Unknown AI analysis mode")
    try:
        images = [image.model_dump() for image in payload.images[:4]]
        result = analyse_with_gemini(mode, payload.text, payload.context, images)
    except GeminiConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except GeminiServiceError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return {
        "mode": mode,
        "result": result,
        "disclaimer": "Momentus AI provides general training, nutrition, and recovery guidance only.",
    }


@app.get("/api/{store}")
def list_store_items(store: str, current_user: dict[str, Any] = Depends(require_authenticated_user)) -> list[dict[str, Any]]:
    valid_store = validate_store(store)
    return get_repository().list_store(current_user["id"], valid_store)


@app.put("/api/{store}/{item_id}")
def put_store_item(
    store: str,
    item_id: str,
    item: dict[str, Any] = Body(...),
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> dict[str, Any]:
    valid_store = validate_store(store)
    payload = dict(item or {})
    payload["id"] = item_id
    persisted = get_repository().upsert_items(current_user["id"], valid_store, [payload])
    return persisted[0]


@app.post("/api/{store}/bulk")
def bulk_put_store_items(
    store: str,
    items: list[dict[str, Any]] = Body(...),
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> list[dict[str, Any]]:
    valid_store = validate_store(store)
    return get_repository().upsert_items(current_user["id"], valid_store, items or [])


@app.delete("/api/{store}/{item_id}")
def delete_store_item(
    store: str,
    item_id: str,
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> Response:
    valid_store = validate_store(store)
    get_repository().delete_item(current_user["id"], valid_store, item_id)
    return Response(status_code=204)


@app.delete("/api/training-data")
def delete_training_data(
    current_user: dict[str, Any] = Depends(require_authenticated_user),
    _: None = Depends(require_csrf),
) -> dict[str, Any]:
    return get_repository().delete_training_data(current_user["id"])


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import settings

_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _encode(payload: dict[str, Any], secret: str) -> str:
    return jwt.encode(payload, secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "type": "access",
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_ttl_minutes)).timestamp()),
    }
    return _encode(payload, settings.jwt_secret)


def create_refresh_token(user_id: str, role: str) -> tuple[str, str, datetime]:
    now = datetime.now(timezone.utc)
    jti = uuid.uuid4().hex
    expires = now + timedelta(days=settings.refresh_token_ttl_days)
    payload = {
        "sub": user_id,
        "role": role,
        "type": "refresh",
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    return _encode(payload, settings.jwt_refresh_secret), jti, expires


def decode_token(token: str, refresh: bool = False) -> dict[str, Any]:
    secret = settings.jwt_refresh_secret if refresh else settings.jwt_secret
    expected_type = "refresh" if refresh else "access"
    payload = jwt.decode(token, secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("unexpected token type")
    return payload

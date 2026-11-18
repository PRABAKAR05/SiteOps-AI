import jwt
from bson import ObjectId

from app.core.config import settings
from app.core.errors import AppError, validation_error
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.database.mongo import get_db
from app.utils.dates import utcnow
from app.utils.serialize import entity


def _public_user(doc: dict) -> dict:
    return entity(doc)


def get_user_by_id(user_id: ObjectId) -> dict:
    user = get_db().users.find_one({"_id": user_id})
    if not user or not user.get("is_active", True):
        raise AppError("UNAUTHENTICATED", "Session is no longer valid.", 401)
    return user


def get_user_by_email(email: str) -> dict | None:
    return get_db().users.find_one({"email": email.lower().strip()})


def register(payload) -> dict:
    if not settings.allow_registration and not settings.seed_demo_data:
        raise AppError("REGISTRATION_DISABLED", "Registration is disabled.", 403)
    db = get_db()
    email = payload.email.lower().strip()
    if db.users.find_one({"email": email}):
        raise AppError("CONFLICT", "An account with this email already exists.", 409)
    now = utcnow()
    doc = {
        "name": payload.name.strip(),
        "email": email,
        "password_hash": hash_password(payload.password),
        "role": payload.role,
        "phone": None,
        "is_active": True,
        "must_change_password": False,
        "created_at": now,
        "updated_at": now,
        "last_login_at": None,
    }
    result = db.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _public_user(doc)


def login(payload, request_id: str | None = None) -> tuple[dict, str, int]:
    db = get_db()
    email = payload.email.lower().strip()
    user = db.users.find_one({"email": email})
    # Perform a dummy verification to keep timing similar for unknown emails.
    if not user:
        hash_password("timing-equalizer")
        raise AppError("INVALID_CREDENTIALS", "Invalid email or password.", 401)
    if not verify_password(user["password_hash"], payload.password):
        raise AppError("INVALID_CREDENTIALS", "Invalid email or password.", 401)
    if not user.get("is_active", True):
        raise AppError("ACCOUNT_DISABLED", "This account is disabled.", 403)

    access = create_access_token(str(user["_id"]), user["role"])
    refresh, jti, expires = create_refresh_token(str(user["_id"]), user["role"])
    db.refresh_tokens.insert_one(
        {
            "jti": jti,
            "user_id": user["_id"],
            "expires_at": expires,
            "revoked": False,
            "created_at": utcnow(),
        }
    )
    db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": utcnow()}})
    return (
        {"access_token": access, "token_type": "bearer", "expires_in": settings.access_token_ttl_minutes * 60,
         "user": _public_user(user)},
        refresh,
        0,
    )


def refresh_session(raw_token: str | None) -> tuple[dict, str]:
    if not raw_token:
        raise AppError("UNAUTHENTICATED", "Missing refresh token.", 401)
    try:
        payload = decode_token(raw_token, refresh=True)
    except jwt.ExpiredSignatureError:
        raise AppError("TOKEN_EXPIRED", "Session expired. Please sign in again.", 401)
    except jwt.InvalidTokenError:
        raise AppError("UNAUTHENTICATED", "Invalid refresh token.", 401)

    db = get_db()
    record = db.refresh_tokens.find_one({"jti": payload.get("jti")})
    if not record or record.get("revoked"):
        # Possible token reuse: revoke everything for this user.
        if record:
            db.refresh_tokens.update_many({"user_id": record["user_id"]}, {"$set": {"revoked": True}})
        raise AppError("UNAUTHENTICATED", "Refresh token is no longer valid.", 401)

    user = get_user_by_id(record["user_id"])
    db.refresh_tokens.update_one({"_id": record["_id"]}, {"$set": {"revoked": True}})
    access = create_access_token(str(user["_id"]), user["role"])
    refresh, jti, expires = create_refresh_token(str(user["_id"]), user["role"])
    db.refresh_tokens.insert_one(
        {
            "jti": jti,
            "user_id": user["_id"],
            "expires_at": expires,
            "revoked": False,
            "created_at": utcnow(),
        }
    )
    return (
        {"access_token": access, "token_type": "bearer", "expires_in": settings.access_token_ttl_minutes * 60,
         "user": _public_user(user)},
        refresh,
    )


def logout(raw_token: str | None) -> None:
    if not raw_token:
        return
    try:
        payload = decode_token(raw_token, refresh=True)
    except jwt.InvalidTokenError:
        return
    get_db().refresh_tokens.update_one({"jti": payload.get("jti")}, {"$set": {"revoked": True}})


def update_profile(user: dict, payload) -> dict:
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return _public_user(user)
    changes["updated_at"] = utcnow()
    get_db().users.update_one({"_id": user["_id"]}, {"$set": changes})
    return _public_user(get_user_by_id(user["_id"]))


def change_password(user: dict, payload) -> None:
    if not verify_password(user["password_hash"], payload.current_password):
        raise validation_error("Current password is incorrect.", [{"field": "current_password", "issue": "incorrect"}])
    db = get_db()
    db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": utcnow()}},
    )
    db.refresh_tokens.update_many({"user_id": user["_id"]}, {"$set": {"revoked": True}})

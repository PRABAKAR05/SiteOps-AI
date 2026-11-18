from typing import Annotated

import jwt
from bson import ObjectId
from fastapi import Depends, Header, Query

from app.core.errors import AppError
from app.core.security import decode_token
from app.database.mongo import get_db


def get_current_user(authorization: Annotated[str | None, Header()] = None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AppError("UNAUTHENTICATED", "Authentication required.", 401)
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise AppError("TOKEN_EXPIRED", "Session expired. Refreshing may fix this.", 401)
    except jwt.InvalidTokenError:
        raise AppError("UNAUTHENTICATED", "Invalid access token.", 401)
    try:
        user_id = ObjectId(payload["sub"])
    except Exception:
        raise AppError("UNAUTHENTICATED", "Invalid access token.", 401)
    user = get_db().users.find_one({"_id": user_id})
    if not user or not user.get("is_active", True):
        raise AppError("UNAUTHENTICATED", "Session is no longer valid.", 401)
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]


def pagination(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)) -> tuple[int, int]:
    return page, page_size


Pagination = Annotated[tuple[int, int], Depends(pagination)]

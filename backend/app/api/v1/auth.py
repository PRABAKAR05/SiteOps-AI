from fastapi import APIRouter, Request, Response

from app.api.deps import CurrentUser
from app.core import rate_limit
from app.core.config import settings
from app.core.errors import AppError
from app.schemas.auth import ChangePasswordIn, LoginIn, ProfileUpdateIn, RegisterIn
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        max_age=settings.refresh_token_ttl_days * 24 * 3600,
        path="/api/v1/auth",
    )


@router.post("/register", status_code=201)
def register(payload: RegisterIn):
    return {"user": auth_service.register(payload)}


@router.post("/login")
def login(payload: LoginIn, request: Request, response: Response):
    client = request.client.host if request.client else "unknown"
    rate_limit.check(f"login:{client}:{payload.email.lower()}", settings.rate_limit_login_per_15_min, 900)
    data, refresh, _ = auth_service.login(payload)
    _set_refresh_cookie(response, refresh)
    return data


@router.post("/refresh")
def refresh(request: Request, response: Response):
    raw = request.cookies.get(settings.refresh_cookie_name)
    data, refresh_token = auth_service.refresh_session(raw)
    _set_refresh_cookie(response, refresh_token)
    return data


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    auth_service.logout(request.cookies.get(settings.refresh_cookie_name))
    response.delete_cookie(settings.refresh_cookie_name, path="/api/v1/auth")


@router.get("/me")
def me(user: CurrentUser):
    return {"user": auth_service._public_user(user)}


@router.patch("/me")
def update_me(payload: ProfileUpdateIn, user: CurrentUser):
    return {"user": auth_service.update_profile(user, payload)}


@router.post("/change-password", status_code=204)
def change_password(payload: ChangePasswordIn, user: CurrentUser):
    auth_service.change_password(user, payload)

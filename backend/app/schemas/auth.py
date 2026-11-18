from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.core.constants import ROLES

EmailAddress = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        max_length=254,
        pattern=r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$",
    ),
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RegisterIn(Strict):
    name: str = Field(min_length=2, max_length=80)
    email: EmailAddress
    password: str = Field(min_length=8, max_length=128)
    role: Literal["project_manager", "site_engineer", "supervisor", "storekeeper"]


class LoginIn(Strict):
    email: EmailAddress
    password: str = Field(min_length=1, max_length=128)


class ProfileUpdateIn(Strict):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    phone: str | None = Field(default=None, max_length=20)


class ChangePasswordIn(Strict):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    phone: str | None = None
    is_active: bool
    created_at: str | None = None

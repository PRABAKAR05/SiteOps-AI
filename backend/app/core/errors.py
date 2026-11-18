from typing import Any


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or []


def not_found(entity: str = "Resource") -> AppError:
    return AppError(f"{entity.upper()}_NOT_FOUND", f"{entity} not found.", 404)


def forbidden(message: str = "You do not have permission to perform this action.") -> AppError:
    return AppError("FORBIDDEN_ROLE", message, 403)


def validation_error(message: str, details: list[dict[str, Any]] | None = None) -> AppError:
    return AppError("VALIDATION_ERROR", message, 422, details)

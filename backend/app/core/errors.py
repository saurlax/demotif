from typing import Any


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, payload: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.payload = payload or {}


class NotFoundError(ApiError):
    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(404, "not_found", message)


class VersionConflictError(ApiError):
    def __init__(self, current_version: int) -> None:
        super().__init__(
            409,
            "version_conflict",
            "The project changed since you loaded it. Refresh before retrying.",
            {"current_version": current_version},
        )


class InvalidCommandError(ApiError):
    def __init__(self, message: str) -> None:
        super().__init__(422, "invalid_command", message)


class LockedSectionError(ApiError):
    def __init__(self, message: str) -> None:
        super().__init__(409, "locked_section", message)

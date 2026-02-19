from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class ErrorCode:
    SESSION_NOT_FOUND: str = "SESSION_NOT_FOUND"
    INVALID_FRAME_INDEX: str = "INVALID_FRAME_INDEX"
    INVALID_POINT: str = "INVALID_POINT"
    INVALID_DIRECTION: str = "INVALID_DIRECTION"
    VIDEO_TOO_LONG: str = "VIDEO_TOO_LONG"
    VIDEO_PROCESSING_FAILED: str = "VIDEO_PROCESSING_FAILED"
    MODEL_RUNTIME_ERROR: str = "MODEL_RUNTIME_ERROR"
    EXPORT_FAILED: str = "EXPORT_FAILED"
    INTERNAL_ERROR: str = "INTERNAL_ERROR"
    BAD_REQUEST: str = "BAD_REQUEST"


def error_detail(
    code: str,
    message: str,
    *,
    details: str | None = None,
    request_id: str | None = None,
) -> dict[str, str]:
    payload: dict[str, str] = {"code": code, "message": message}
    if details:
        payload["details"] = details
    if request_id:
        payload["request_id"] = request_id
    return payload


def http_error(
    status_code: int,
    code: str,
    message: str,
    *,
    details: str | None = None,
    request_id: str | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=error_detail(code, message, details=details, request_id=request_id),
    )

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
    BAD_REQUEST: str = "BAD_REQUEST"


def http_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})

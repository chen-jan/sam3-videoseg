from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import (
    HTTPException,
    FastAPI,
    File,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError

from app.config import Settings, ensure_directories
from app.errors import ErrorCode, error_detail, http_error
from app.models import (
    ClickPromptRequest,
    CreateObjectResponse,
    ExportRequest,
    OperationResponse,
    PromptResponse,
    PropagationStartMessage,
    TextPromptRequest,
    UploadResponse,
)
from app.sam3_service import Sam3Service
from app.session_store import SessionRecord, SessionStore
from app.video_io import (
    ALLOWED_VIDEO_EXTS,
    cleanup_path,
    compute_processing_fps,
    count_extracted_frames,
    extract_frames,
    get_frame_path,
    is_duration_allowed,
    probe_video,
    probe_image_size,
    save_upload_file,
)


settings = Settings()
ensure_directories(settings)
session_store = SessionStore()
sam3_service = Sam3Service(session_store=session_store)
logger = logging.getLogger(__name__)

app = FastAPI(title="SAM3 Demo Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", uuid.uuid4().hex)
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(HTTPException)
async def handle_http_exception(request: Request, exc: HTTPException):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    if isinstance(exc.detail, dict):
        detail = dict(exc.detail)
    else:
        detail = error_detail(ErrorCode.BAD_REQUEST, str(exc.detail))
    detail.setdefault("request_id", request_id)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail},
        headers={"X-Request-ID": request_id},
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_exception(request: Request, exc: RequestValidationError):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    detail = error_detail(
        ErrorCode.BAD_REQUEST,
        "Invalid request payload",
        details=str(exc),
        request_id=request_id,
    )
    return JSONResponse(
        status_code=422,
        content={"detail": detail},
        headers={"X-Request-ID": request_id},
    )


@app.exception_handler(Exception)
async def handle_unexpected_exception(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    logger.exception("Unhandled server error request_id=%s", request_id)
    detail = error_detail(
        ErrorCode.INTERNAL_ERROR,
        "Internal server error",
        details=str(exc),
        request_id=request_id,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": detail},
        headers={"X-Request-ID": request_id},
    )


def _require_session(session_id: str) -> SessionRecord:
    try:
        return session_store.require(session_id)
    except KeyError:
        raise http_error(404, ErrorCode.SESSION_NOT_FOUND, "Session not found")


def _validate_frame_index(record: SessionRecord, frame_index: int) -> None:
    if frame_index < 0 or frame_index >= record.num_frames:
        raise http_error(
            400,
            ErrorCode.INVALID_FRAME_INDEX,
            f"frame_index must be in [0, {record.num_frames - 1}]",
        )


def _validate_points(points: list[tuple[float, float, int]]) -> None:
    for x, y, label in points:
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            raise http_error(
                400,
                ErrorCode.INVALID_POINT,
                "Point coordinates must be normalized between 0 and 1",
            )
        if label not in (0, 1):
            raise http_error(
                400,
                ErrorCode.INVALID_POINT,
                "Point label must be either 0 (negative) or 1 (positive)",
            )


def _cleanup_active_session() -> None:
    active = session_store.get_active()
    if active is None:
        return
    try:
        sam3_service.close_session(active.session_id)
    except Exception:
        pass
    cleanup_path(active.upload_path)
    cleanup_path(active.frames_dir)
    session_store.clear_active()


@app.on_event("startup")
def on_startup() -> None:
    if settings.load_model_on_startup:
        sam3_service.load_predictor()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/videos/upload", response_model=UploadResponse)
async def upload_video(file: UploadFile = File(...)) -> UploadResponse:
    filename = file.filename or "upload.mp4"
    ext = Path(filename).suffix.lower() or ".mp4"
    if ext not in ALLOWED_VIDEO_EXTS:
        raise http_error(
            400,
            ErrorCode.BAD_REQUEST,
            f"Unsupported extension '{ext}'. Allowed: {sorted(ALLOWED_VIDEO_EXTS)}",
        )

    upload_path = settings.uploads_dir / f"{uuid.uuid4().hex}{ext}"
    await save_upload_file(file, upload_path)

    frames_dir: Path | None = None
    try:
        metadata = probe_video(upload_path)
        if not is_duration_allowed(metadata.duration_sec, settings.max_duration_sec):
            cleanup_path(upload_path)
            raise http_error(
                400,
                ErrorCode.VIDEO_TOO_LONG,
                f"Video duration {metadata.duration_sec:.2f}s exceeds max {settings.max_duration_sec:.2f}s",
            )

        processing_fps = compute_processing_fps(
            source_fps=metadata.fps,
            duration_sec=metadata.duration_sec,
            max_frames=settings.max_frames,
        )

        _cleanup_active_session()

        session_id = uuid.uuid4().hex
        frames_dir = settings.frames_dir / session_id
        extract_frames(
            video_path=upload_path,
            frames_dir=frames_dir,
            processing_fps=processing_fps,
            max_frames=settings.max_frames,
        )

        processing_num_frames = count_extracted_frames(frames_dir)
        if processing_num_frames <= 0:
            raise RuntimeError("No frames were extracted from video")
        first_frame_path = get_frame_path(frames_dir, 0)
        try:
            frame_width, frame_height = probe_image_size(first_frame_path)
        except Exception:
            frame_width, frame_height = metadata.width, metadata.height

        actual_session_id = sam3_service.start_session(
            session_id=session_id,
            resource_path=frames_dir,
        )

        record = SessionRecord(
            session_id=actual_session_id,
            upload_path=upload_path,
            frames_dir=frames_dir,
            num_frames=processing_num_frames,
            width=frame_width,
            height=frame_height,
            source_fps=float(metadata.fps),
            processing_fps=float(processing_fps),
            source_duration_sec=float(metadata.duration_sec),
        )
        session_store.set_active(record)

        return UploadResponse(
            session_id=actual_session_id,
            num_frames=processing_num_frames,
            width=frame_width,
            height=frame_height,
            source_fps=float(metadata.fps),
            processing_fps=float(processing_fps),
            source_duration_sec=float(metadata.duration_sec),
            processing_num_frames=processing_num_frames,
        )
    except HTTPException:
        if frames_dir is not None:
            cleanup_path(frames_dir)
        raise
    except Exception as exc:
        if frames_dir is not None:
            cleanup_path(frames_dir)
        cleanup_path(upload_path)
        logger.exception("upload_failed filename=%s", filename)
        raise http_error(
            500,
            ErrorCode.VIDEO_PROCESSING_FAILED,
            f"Failed to process video: {exc}",
        )


@app.get("/api/sessions/{session_id}/frames/{frame_index}.jpg")
def get_frame(session_id: str, frame_index: int):
    record = _require_session(session_id)
    _validate_frame_index(record, frame_index)
    try:
        frame_path = get_frame_path(record.frames_dir, frame_index)
    except FileNotFoundError:
        raise http_error(
            404, ErrorCode.INVALID_FRAME_INDEX, "Frame image not found on disk"
        )
    return FileResponse(str(frame_path), media_type="image/jpeg")


@app.post("/api/sessions/{session_id}/prompt/text", response_model=PromptResponse)
def add_text_prompt(session_id: str, req: TextPromptRequest) -> PromptResponse:
    record = _require_session(session_id)
    _validate_frame_index(record, req.frame_index)
    text = req.text.strip()
    if not text:
        raise http_error(400, ErrorCode.BAD_REQUEST, "Text prompt cannot be empty")

    try:
        frame_index, objects = sam3_service.add_text_prompt(
            session_id=session_id,
            frame_index=req.frame_index,
            text=text,
            reset_first=req.reset_first,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "text_prompt_failed session_id=%s frame_index=%s",
            session_id,
            req.frame_index,
        )
        raise http_error(
            500,
            ErrorCode.MODEL_RUNTIME_ERROR,
            "Text prompt failed",
            details=str(exc),
        )
    return PromptResponse(frame_index=frame_index, objects=objects)


@app.post("/api/sessions/{session_id}/objects", response_model=CreateObjectResponse)
def create_object(session_id: str) -> CreateObjectResponse:
    _require_session(session_id)
    obj_id = session_store.next_user_obj_id(session_id)
    return CreateObjectResponse(obj_id=obj_id)


@app.post("/api/sessions/{session_id}/prompt/clicks", response_model=PromptResponse)
def add_click_prompt(session_id: str, req: ClickPromptRequest) -> PromptResponse:
    record = _require_session(session_id)
    _validate_frame_index(record, req.frame_index)
    if len(req.points) == 0:
        raise http_error(400, ErrorCode.BAD_REQUEST, "At least one point is required")

    points = [(point.x, point.y, int(point.label)) for point in req.points]
    _validate_points(points)

    try:
        frame_index, objects = sam3_service.add_click_prompt(
            session_id=session_id,
            frame_index=req.frame_index,
            obj_id=req.obj_id,
            points=points,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "click_prompt_failed session_id=%s frame_index=%s obj_id=%s",
            session_id,
            req.frame_index,
            req.obj_id,
        )
        raise http_error(
            500,
            ErrorCode.MODEL_RUNTIME_ERROR,
            "Click prompt failed",
            details=str(exc),
        )
    return PromptResponse(frame_index=frame_index, objects=objects)


@app.post("/api/sessions/{session_id}/objects/{obj_id}/remove", response_model=OperationResponse)
def remove_object(session_id: str, obj_id: int) -> OperationResponse:
    _require_session(session_id)
    sam3_service.remove_object(session_id=session_id, obj_id=obj_id)
    return OperationResponse(ok=True)


@app.post("/api/sessions/{session_id}/reset", response_model=OperationResponse)
def reset_session(session_id: str) -> OperationResponse:
    _require_session(session_id)
    sam3_service.reset_session(session_id)
    return OperationResponse(ok=True)


@app.post("/api/sessions/{session_id}/exports")
def export_session_data(session_id: str, req: ExportRequest) -> Response:
    record = _require_session(session_id)
    try:
        archive_bytes = sam3_service.export_session(session_id=session_id, record=record, req=req)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("export_failed session_id=%s", session_id)
        raise http_error(
            500,
            ErrorCode.EXPORT_FAILED,
            "Failed to export session data",
            details=str(exc),
        )

    filename = f"sam3-export-{session_id[:8]}.zip"
    return Response(
        content=archive_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/api/sessions/{session_id}", response_model=OperationResponse)
def delete_session(session_id: str) -> OperationResponse:
    record = _require_session(session_id)
    try:
        sam3_service.close_session(session_id)
    finally:
        cleanup_path(record.upload_path)
        cleanup_path(record.frames_dir)
        session_store.clear_active()
    return OperationResponse(ok=True)


@app.websocket("/api/sessions/{session_id}/propagate")
async def propagate(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    ws_request_id = uuid.uuid4().hex
    start_msg: PropagationStartMessage | None = None
    try:
        record = _require_session(session_id)
        start_raw = await websocket.receive_json()
        start_msg = PropagationStartMessage.model_validate(start_raw)

        if start_msg.start_frame_index is not None:
            _validate_frame_index(record, start_msg.start_frame_index)

        generation = session_store.bump_generation(session_id)
        for frame_index, objects in sam3_service.stream_propagation(
            session_id=session_id,
            direction=start_msg.direction,
            start_frame_index=start_msg.start_frame_index,
            generation=generation,
        ):
            await websocket.send_json(
                {
                    "type": "propagation_frame",
                    "frame_index": frame_index,
                    "objects": objects,
                }
            )

        await websocket.send_json({"type": "propagation_done"})
    except WebSocketDisconnect:
        return
    except ValidationError as exc:
        await websocket.send_json(
            {
                "type": "error",
                "code": ErrorCode.BAD_REQUEST,
                "message": f"Invalid websocket payload: {exc}",
                "request_id": ws_request_id,
            }
        )
    except Exception as exc:
        logger.exception(
            "propagation_failed session_id=%s direction=%s start_frame_index=%s request_id=%s",
            session_id,
            None if start_msg is None else start_msg.direction,
            None if start_msg is None else start_msg.start_frame_index,
            ws_request_id,
        )
        await websocket.send_json(
            {
                "type": "error",
                "code": ErrorCode.MODEL_RUNTIME_ERROR,
                "message": "Propagation failed",
                "details": str(exc),
                "request_id": ws_request_id,
            }
        )
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass

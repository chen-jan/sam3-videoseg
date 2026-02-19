from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.export_utils import build_export_archive
from app.mask_codec import encode_sam3_outputs
from app.models import ExportRequest
from app.session_store import SessionRecord, SessionStore


logger = logging.getLogger(__name__)


class Sam3Service:
    def __init__(self, session_store: SessionStore) -> None:
        self.session_store = session_store
        self.predictor = None

    def load_predictor(self) -> None:
        if self.predictor is not None:
            return
        from huggingface_hub.errors import GatedRepoError
        from sam3.model_builder import build_sam3_video_predictor

        try:
            self.predictor = build_sam3_video_predictor()
        except GatedRepoError as exc:
            raise RuntimeError(
                "SAM3 model weights are gated on Hugging Face. "
                "Run `hf auth login` (or `python3 -m huggingface_hub.cli.hf auth login`) "
                "with an account that has access to "
                "`facebook/sam3`, or set SAM3_DEMO_LOAD_MODEL_ON_STARTUP=0."
            ) from exc

    def _ensure_predictor(self):
        if self.predictor is None:
            self.load_predictor()
        return self.predictor

    def start_session(self, session_id: str, resource_path: Path) -> str:
        predictor = self._ensure_predictor()
        response = predictor.handle_request(
            request={
                "type": "start_session",
                "session_id": session_id,
                "resource_path": str(resource_path),
            }
        )
        return str(response["session_id"])

    def add_text_prompt(
        self,
        session_id: str,
        frame_index: int,
        text: str,
        reset_first: bool = True,
    ) -> tuple[int, list[dict[str, object]]]:
        predictor = self._ensure_predictor()
        self.session_store.bump_generation(session_id)

        if reset_first:
            predictor.handle_request(
                request={"type": "reset_session", "session_id": session_id}
            )
            self.session_store.clear_click_history(session_id)
            self.session_store.reset_object_counter(session_id)

        logger.info(
            "text_prompt session_id=%s frame_index=%s text=%s reset_first=%s",
            session_id,
            frame_index,
            text,
            reset_first,
        )
        response = predictor.handle_request(
            request={
                "type": "add_prompt",
                "session_id": session_id,
                "frame_index": frame_index,
                "text": text,
            }
        )
        return int(response["frame_index"]), encode_sam3_outputs(response["outputs"])

    def add_click_prompt(
        self,
        session_id: str,
        frame_index: int,
        obj_id: int,
        points: list[tuple[float, float, int]],
    ) -> tuple[int, list[dict[str, object]]]:
        predictor = self._ensure_predictor()
        self._seed_frame_cache_if_needed(session_id=session_id, frame_index=frame_index)
        self.session_store.bump_generation(session_id)
        all_points = self.session_store.add_click_points(
            session_id=session_id,
            obj_id=obj_id,
            frame_index=frame_index,
            points=points,
        )
        logger.info(
            "click_prompt session_id=%s frame_index=%s obj_id=%s num_points=%s",
            session_id,
            frame_index,
            obj_id,
            len(points),
        )
        point_coords = [[x, y] for x, y, _ in all_points]
        point_labels = [label for _, _, label in all_points]

        response = predictor.handle_request(
            request={
                "type": "add_prompt",
                "session_id": session_id,
                "frame_index": frame_index,
                "obj_id": obj_id,
                "points": point_coords,
                "point_labels": point_labels,
            }
        )
        return int(response["frame_index"]), encode_sam3_outputs(response["outputs"])

    def remove_object(self, session_id: str, obj_id: int) -> None:
        predictor = self._ensure_predictor()
        self.session_store.bump_generation(session_id)
        predictor.handle_request(
            request={
                "type": "remove_object",
                "session_id": session_id,
                "obj_id": obj_id,
            }
        )
        self.session_store.clear_click_history_for_obj(session_id, obj_id)

    def reset_session(self, session_id: str) -> None:
        predictor = self._ensure_predictor()
        self.session_store.bump_generation(session_id)
        predictor.handle_request(
            request={"type": "reset_session", "session_id": session_id}
        )
        self.session_store.clear_click_history(session_id)
        self.session_store.reset_object_counter(session_id)

    def close_session(self, session_id: str) -> None:
        predictor = self._ensure_predictor()
        predictor.handle_request(
            request={"type": "close_session", "session_id": session_id}
        )

    def stream_propagation(
        self,
        session_id: str,
        direction: str,
        start_frame_index: int | None,
        generation: int,
    ):
        predictor = self._ensure_predictor()
        request = {
            "type": "propagate_in_video",
            "session_id": session_id,
            "propagation_direction": direction,
        }
        if start_frame_index is not None:
            request["start_frame_index"] = start_frame_index

        for response in predictor.handle_stream_request(request=request):
            if not self.session_store.is_generation_current(session_id, generation):
                break
            frame_index = int(response["frame_index"])
            objects = encode_sam3_outputs(response["outputs"])
            yield frame_index, objects

    def export_session(
        self,
        session_id: str,
        record: SessionRecord,
        req: ExportRequest,
    ) -> bytes:
        predictor = self._ensure_predictor()
        state = self._get_inference_state(session_id)

        frame_start = req.scope.frame_start if req.scope.frame_start is not None else 0
        frame_end = (
            req.scope.frame_end if req.scope.frame_end is not None else record.num_frames - 1
        )
        frame_start = max(0, min(frame_start, record.num_frames - 1))
        frame_end = max(0, min(frame_end, record.num_frames - 1))
        if frame_start > frame_end:
            frame_start, frame_end = frame_end, frame_start

        if req.auto_propagate_if_incomplete:
            missing = [
                idx
                for idx in range(frame_start, frame_end + 1)
                if idx not in state.get("cached_frame_outputs", {})
            ]
            if missing:
                logger.info(
                    "export_auto_propagate session_id=%s start=%s end=%s missing=%s",
                    session_id,
                    frame_start,
                    frame_end,
                    len(missing),
                )
                for _ in predictor.handle_stream_request(
                    request={
                        "type": "propagate_in_video",
                        "session_id": session_id,
                        "propagation_direction": "both",
                        "start_frame_index": frame_start,
                    }
                ):
                    pass

        return build_export_archive(
            record=record,
            cached_frame_outputs=state.get("cached_frame_outputs", {}),
            req=req,
        )

    def _seed_frame_cache_if_needed(self, session_id: str, frame_index: int) -> None:
        state = self._get_inference_state(session_id)
        cached = state.get("cached_frame_outputs", {})
        if frame_index in cached:
            return

        predictor = self._ensure_predictor()
        model = getattr(predictor, "model", None)
        if model is not None and hasattr(model, "_run_single_frame_inference"):
            logger.info(
                "auto_seed_frame_cache_single_frame session_id=%s frame_index=%s",
                session_id,
                frame_index,
            )
            try:
                model._run_single_frame_inference(state, frame_index, reverse=False)
            except Exception:
                logger.warning(
                    "single_frame_seed_failed session_id=%s frame_index=%s",
                    session_id,
                    frame_index,
                    exc_info=True,
                )

        cached = state.get("cached_frame_outputs", {})
        if frame_index in cached:
            return

        logger.info(
            "auto_seed_frame_cache_stream session_id=%s frame_index=%s",
            session_id,
            frame_index,
        )
        try:
            stream = predictor.handle_stream_request(
                request={
                    "type": "propagate_in_video",
                    "session_id": session_id,
                    "propagation_direction": "forward",
                    "start_frame_index": frame_index,
                }
            )
            next(stream, None)
        except Exception:
            logger.warning(
                "stream_seed_failed session_id=%s frame_index=%s",
                session_id,
                frame_index,
                exc_info=True,
            )

        cached = state.get("cached_frame_outputs", {})
        if frame_index not in cached:
            raise RuntimeError(
                f"Unable to seed cache for frame {frame_index}. "
                "Add a text prompt or run propagation first."
            )

    def _get_inference_state(self, session_id: str) -> dict[str, Any]:
        predictor = self._ensure_predictor()
        session = predictor._get_session(session_id)
        return session["state"]

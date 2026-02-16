from __future__ import annotations

from pathlib import Path

from app.mask_codec import encode_sam3_outputs
from app.session_store import SessionStore


class Sam3Service:
    def __init__(self, session_store: SessionStore) -> None:
        self.session_store = session_store
        self.predictor = None

    def load_predictor(self) -> None:
        if self.predictor is not None:
            return
        from sam3.model_builder import build_sam3_video_predictor

        self.predictor = build_sam3_video_predictor()

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
        self.session_store.bump_generation(session_id)
        all_points = self.session_store.add_click_points(
            session_id=session_id,
            obj_id=obj_id,
            frame_index=frame_index,
            points=points,
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

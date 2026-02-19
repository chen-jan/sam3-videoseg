from __future__ import annotations

from pathlib import Path

from app.sam3_service import Sam3Service
from app.session_store import SessionRecord, SessionStore


class _FakeModel:
    def __init__(self, propagation_type: str) -> None:
        self._propagation_type = propagation_type

    def parse_action_history_for_propagation(self, _inference_state):
        if self._propagation_type == "propagation_partial":
            return "propagation_partial", [-1]
        return self._propagation_type, None


class _FakePredictor:
    def __init__(self, state: dict, propagation_type: str = "propagation_full") -> None:
        self._session = {"state": state}
        self.model = _FakeModel(propagation_type)
        self.requests: list[dict] = []

    def handle_request(self, request: dict):
        self.requests.append(request)
        if request["type"] == "add_prompt":
            return {"frame_index": request["frame_index"], "outputs": {}}
        if request["type"] in {"reset_session", "remove_object", "close_session"}:
            return {"is_success": True}
        raise AssertionError(f"Unexpected request: {request}")

    def handle_stream_request(self, request: dict):
        assert request["type"] == "propagate_in_video"
        yield {"frame_index": 0, "outputs": {}}

    def _get_session(self, _session_id: str):
        return self._session


def _make_store_with_session(tmp_path: Path) -> tuple[SessionStore, str]:
    session_id = "s1"
    store = SessionStore()
    store.set_active(
        SessionRecord(
            session_id=session_id,
            upload_path=tmp_path / "upload.mp4",
            frames_dir=tmp_path / "frames",
            num_frames=4,
            width=640,
            height=360,
            source_fps=30.0,
            processing_fps=15.0,
            source_duration_sec=10.0,
        )
    )
    return store, session_id


def test_manual_object_ids_do_not_reset_on_text_prompt_or_reset(tmp_path: Path) -> None:
    store, session_id = _make_store_with_session(tmp_path)
    predictor = _FakePredictor(
        state={"num_frames": 4, "cached_frame_outputs": {}, "action_history": []}
    )
    service = Sam3Service(session_store=store)
    service.predictor = predictor

    assert store.next_user_obj_id(session_id) == -1

    service.add_text_prompt(
        session_id=session_id,
        frame_index=0,
        text="person",
        reset_first=False,
    )
    assert predictor.requests[-1]["type"] == "add_prompt"
    assert predictor.requests[-1]["reset_state"] is False
    assert store.next_user_obj_id(session_id) == -2

    service.reset_session(session_id)
    assert store.next_user_obj_id(session_id) == -3


def test_partial_propagation_prefills_missing_cache_entries(tmp_path: Path) -> None:
    store, session_id = _make_store_with_session(tmp_path)
    state = {
        "num_frames": 4,
        "cached_frame_outputs": {0: {"baseline": True}},
        "action_history": [{"type": "add", "obj_ids": [-1], "frame_idx": 0}],
    }
    service = Sam3Service(session_store=store)
    service.predictor = _FakePredictor(state=state, propagation_type="propagation_partial")

    frames = list(
        service.stream_propagation(
            session_id=session_id,
            direction="both",
            start_frame_index=None,
            generation=0,
        )
    )

    assert frames == [(0, [])]
    assert set(state["cached_frame_outputs"].keys()) == {0, 1, 2, 3}
    assert state["cached_frame_outputs"][0] == {"baseline": True}


def test_text_prompt_reset_first_true_forwards_reset_state_true(tmp_path: Path) -> None:
    store, session_id = _make_store_with_session(tmp_path)
    predictor = _FakePredictor(
        state={"num_frames": 4, "cached_frame_outputs": {}, "action_history": []}
    )
    service = Sam3Service(session_store=store)
    service.predictor = predictor

    service.add_text_prompt(
        session_id=session_id,
        frame_index=0,
        text="car",
        reset_first=True,
    )

    add_prompt_requests = [req for req in predictor.requests if req["type"] == "add_prompt"]
    assert len(add_prompt_requests) == 1
    assert add_prompt_requests[0]["reset_state"] is True

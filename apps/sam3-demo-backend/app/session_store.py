from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock


@dataclass
class SessionRecord:
    session_id: str
    upload_path: Path
    frames_dir: Path
    num_frames: int
    width: int
    height: int
    source_fps: float
    processing_fps: float
    source_duration_sec: float
    generation: int = 0
    next_user_obj_id: int = -1
    click_history: dict[tuple[int, int], list[tuple[float, float, int]]] = field(
        default_factory=dict
    )


class SessionStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._active: SessionRecord | None = None

    def _require_unlocked(self, session_id: str) -> SessionRecord:
        if self._active is None or self._active.session_id != session_id:
            raise KeyError(session_id)
        return self._active

    def has_active(self) -> bool:
        with self._lock:
            return self._active is not None

    def get_active(self) -> SessionRecord | None:
        with self._lock:
            return self._active

    def set_active(self, record: SessionRecord) -> None:
        with self._lock:
            self._active = record

    def clear_active(self) -> SessionRecord | None:
        with self._lock:
            old = self._active
            self._active = None
            return old

    def require(self, session_id: str) -> SessionRecord:
        with self._lock:
            return self._require_unlocked(session_id)

    def bump_generation(self, session_id: str) -> int:
        with self._lock:
            record = self._require_unlocked(session_id)
            record.generation += 1
            return record.generation

    def is_generation_current(self, session_id: str, generation: int) -> bool:
        with self._lock:
            record = self._require_unlocked(session_id)
            return record.generation == generation

    def reset_object_counter(self, session_id: str) -> None:
        with self._lock:
            record = self._require_unlocked(session_id)
            record.next_user_obj_id = -1

    def next_user_obj_id(self, session_id: str) -> int:
        with self._lock:
            record = self._require_unlocked(session_id)
            obj_id = record.next_user_obj_id
            record.next_user_obj_id -= 1
            return obj_id

    def add_click_points(
        self, session_id: str, obj_id: int, frame_index: int, points: list[tuple[float, float, int]]
    ) -> list[tuple[float, float, int]]:
        with self._lock:
            record = self._require_unlocked(session_id)
            key = (obj_id, frame_index)
            existing = record.click_history.get(key, [])
            existing.extend(points)
            record.click_history[key] = existing
            return existing.copy()

    def clear_click_history(self, session_id: str) -> None:
        with self._lock:
            record = self._require_unlocked(session_id)
            record.click_history.clear()

    def clear_click_history_for_obj(self, session_id: str, obj_id: int) -> None:
        with self._lock:
            record = self._require_unlocked(session_id)
            keys = [key for key in record.click_history if key[0] == obj_id]
            for key in keys:
                del record.click_history[key]

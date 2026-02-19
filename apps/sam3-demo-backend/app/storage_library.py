from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from app.video_io import ALLOWED_VIDEO_EXTS


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mtime_iso(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


@dataclass(frozen=True)
class StoredVideo:
    video_id: str
    file_name: str
    display_name: str
    size_bytes: int
    created_at: str
    updated_at: str


class StorageLibrary:
    def __init__(self, uploads_dir: Path) -> None:
        self.uploads_dir = uploads_dir
        self.manifest_path = uploads_dir / "library.json"
        self._lock = Lock()

    def register_video(self, video_id: str, file_name: str, display_name: str) -> None:
        with self._lock:
            manifest = self._load_manifest_unlocked()
            now = _now_iso()
            manifest[video_id] = {
                "file_name": file_name,
                "display_name": display_name,
                "created_at": manifest.get(video_id, {}).get("created_at", now),
                "updated_at": now,
            }
            self._save_manifest_unlocked(manifest)

    def resolve_video_path(self, video_id: str) -> Path | None:
        with self._lock:
            manifest = self._load_manifest_unlocked()
            return self._resolve_video_path_unlocked(video_id, manifest)

    def list_videos(self) -> list[StoredVideo]:
        with self._lock:
            manifest = self._load_manifest_unlocked()
            listed: list[StoredVideo] = []
            seen_files: set[str] = set()

            for video_id, entry in manifest.items():
                file_name = str(entry.get("file_name", ""))
                if not file_name:
                    continue
                path = self.uploads_dir / file_name
                if not path.exists() or not path.is_file():
                    continue
                if path.suffix.lower() not in ALLOWED_VIDEO_EXTS:
                    continue
                seen_files.add(file_name)
                listed.append(
                    StoredVideo(
                        video_id=video_id,
                        file_name=file_name,
                        display_name=str(entry.get("display_name", video_id)),
                        size_bytes=path.stat().st_size,
                        created_at=str(entry.get("created_at", _mtime_iso(path))),
                        updated_at=str(entry.get("updated_at", _mtime_iso(path))),
                    )
                )

            for path in self.uploads_dir.iterdir():
                if not path.is_file() or path.name in seen_files:
                    continue
                if path.suffix.lower() not in ALLOWED_VIDEO_EXTS:
                    continue
                listed.append(
                    StoredVideo(
                        video_id=path.stem,
                        file_name=path.name,
                        display_name=path.stem,
                        size_bytes=path.stat().st_size,
                        created_at=_mtime_iso(path),
                        updated_at=_mtime_iso(path),
                    )
                )

            listed.sort(key=lambda v: v.updated_at, reverse=True)
            return listed

    def rename_video(self, video_id: str, display_name: str) -> StoredVideo | None:
        normalized = display_name.strip()
        if not normalized:
            return None
        with self._lock:
            manifest = self._load_manifest_unlocked()
            entry = manifest.get(video_id)
            path: Path | None = None
            if entry is not None:
                path = self.uploads_dir / str(entry.get("file_name", ""))
                if not path.exists():
                    path = None
            if path is None:
                path = self._resolve_video_path_unlocked(video_id, manifest)
                if path is None:
                    return None
                entry = {
                    "file_name": path.name,
                    "created_at": _mtime_iso(path),
                }

            now = _now_iso()
            manifest[video_id] = {
                "file_name": str(entry.get("file_name", path.name)),
                "display_name": normalized,
                "created_at": str(entry.get("created_at", _mtime_iso(path))),
                "updated_at": now,
            }
            self._save_manifest_unlocked(manifest)
            return StoredVideo(
                video_id=video_id,
                file_name=path.name,
                display_name=normalized,
                size_bytes=path.stat().st_size,
                created_at=str(manifest[video_id]["created_at"]),
                updated_at=now,
            )

    def delete_videos(self, video_ids: list[str]) -> int:
        deleted = 0
        with self._lock:
            manifest = self._load_manifest_unlocked()
            for video_id in video_ids:
                path = None
                entry = manifest.get(video_id)
                if entry is not None:
                    candidate = self.uploads_dir / str(entry.get("file_name", ""))
                    if candidate.exists() and candidate.is_file():
                        path = candidate
                if path is None:
                    for ext in ALLOWED_VIDEO_EXTS:
                        candidate = self.uploads_dir / f"{video_id}{ext}"
                        if candidate.exists() and candidate.is_file():
                            path = candidate
                            break

                if path is not None:
                    try:
                        path.unlink()
                        deleted += 1
                    except FileNotFoundError:
                        pass
                manifest.pop(video_id, None)
            self._save_manifest_unlocked(manifest)
        return deleted

    def storage_status(self, storage_root: Path) -> dict[str, int | str]:
        root = storage_root if storage_root.exists() else self.uploads_dir
        usage = shutil.disk_usage(root)
        uploads_bytes = 0
        uploads_count = 0
        for path in self.uploads_dir.iterdir():
            if path.is_file() and path.suffix.lower() in ALLOWED_VIDEO_EXTS:
                uploads_count += 1
                uploads_bytes += path.stat().st_size
        return {
            "storage_root": str(root.resolve()),
            "total_bytes": int(usage.total),
            "used_bytes": int(usage.used),
            "free_bytes": int(usage.free),
            "uploads_bytes": int(uploads_bytes),
            "uploads_count": int(uploads_count),
        }

    def _load_manifest_unlocked(self) -> dict[str, dict[str, str]]:
        if not self.manifest_path.exists():
            return {}
        try:
            payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        normalized: dict[str, dict[str, str]] = {}
        for key, value in payload.items():
            if not isinstance(key, str) or not isinstance(value, dict):
                continue
            normalized[key] = {
                k: str(v)
                for k, v in value.items()
                if k in {"file_name", "display_name", "created_at", "updated_at"}
            }
        return normalized

    def _save_manifest_unlocked(self, manifest: dict[str, dict[str, str]]) -> None:
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    def _resolve_video_path_unlocked(
        self, video_id: str, manifest: dict[str, dict[str, str]]
    ) -> Path | None:
        entry = manifest.get(video_id)
        if entry is not None:
            path = self.uploads_dir / str(entry.get("file_name", ""))
            if path.exists() and path.is_file():
                return path
        for ext in ALLOWED_VIDEO_EXTS:
            candidate = self.uploads_dir / f"{video_id}{ext}"
            if candidate.exists() and candidate.is_file():
                return candidate
        return None

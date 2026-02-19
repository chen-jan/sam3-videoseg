from __future__ import annotations

from pathlib import Path

from app.storage_library import StorageLibrary


def test_storage_library_register_list_rename_delete(tmp_path: Path) -> None:
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    video_id = "abc123"
    file_name = f"{video_id}.mp4"
    video_path = uploads_dir / file_name
    video_path.write_bytes(b"video-bytes")

    lib = StorageLibrary(uploads_dir)
    lib.register_video(video_id=video_id, file_name=file_name, display_name="Initial Name")

    resolved = lib.resolve_video_path(video_id)
    assert resolved == video_path

    listed = lib.list_videos()
    assert len(listed) == 1
    assert listed[0].video_id == video_id
    assert listed[0].display_name == "Initial Name"
    assert listed[0].size_bytes == len(b"video-bytes")

    renamed = lib.rename_video(video_id, "Renamed")
    assert renamed is not None
    assert renamed.display_name == "Renamed"

    listed_after_rename = lib.list_videos()
    assert len(listed_after_rename) == 1
    assert listed_after_rename[0].display_name == "Renamed"

    status_before_delete = lib.storage_status(tmp_path)
    assert status_before_delete["uploads_count"] == 1
    assert status_before_delete["uploads_bytes"] == len(b"video-bytes")

    deleted = lib.delete_videos([video_id])
    assert deleted == 1
    assert not video_path.exists()
    assert lib.resolve_video_path(video_id) is None

    status_after_delete = lib.storage_status(tmp_path)
    assert status_after_delete["uploads_count"] == 0

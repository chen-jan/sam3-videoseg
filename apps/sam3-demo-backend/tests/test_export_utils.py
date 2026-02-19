from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import numpy as np

from app.export_utils import build_export_archive
from app.models import ExportRequest
from app.session_store import SessionRecord


def _make_record(tmp_path: Path) -> SessionRecord:
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for i in range(3):
        (frames_dir / f"{i:06d}.jpg").write_bytes(b"jpg")

    return SessionRecord(
        session_id="sess1",
        upload_path=tmp_path / "upload.mp4",
        frames_dir=frames_dir,
        num_frames=3,
        width=10,
        height=8,
        source_fps=30.0,
        processing_fps=15.0,
        source_duration_sec=2.0,
    )


def test_export_archive_includes_requested_artifacts(tmp_path: Path) -> None:
    record = _make_record(tmp_path)

    mask = np.zeros((8, 10), dtype=bool)
    mask[2:5, 3:7] = True
    cached = {0: {1: mask}, 1: {1: mask}}

    req = ExportRequest.model_validate(
        {
            "formats": ["coco_instance", "yolo_segmentation"],
            "object_meta": [{"obj_id": 1, "class_name": "cow", "instance_name": "cow_1"}],
            "merge": {"mode": "none", "groups": []},
            "scope": {"frame_start": 0, "frame_end": 1, "include_images": True},
            "auto_propagate_if_incomplete": False,
        }
    )

    archive = build_export_archive(record=record, cached_frame_outputs=cached, req=req)
    with zipfile.ZipFile(io.BytesIO(archive), "r") as zf:
        names = set(zf.namelist())
        assert "annotations/coco_instances.json" in names
        assert "annotations/yolo/classes.txt" in names
        assert "annotations/yolo/labels/000000.txt" in names
        assert "images/000000.jpg" in names
        assert "manifest.json" in names

        coco = json.loads(zf.read("annotations/coco_instances.json"))
        assert len(coco["images"]) == 2
        assert len(coco["annotations"]) == 2
        assert coco["categories"][0]["name"] == "cow"


def test_export_archive_destructive_merge_replaces_group_members(tmp_path: Path) -> None:
    record = _make_record(tmp_path)

    mask_a = np.zeros((8, 10), dtype=bool)
    mask_b = np.zeros((8, 10), dtype=bool)
    mask_a[0:2, 0:2] = True
    mask_b[0:2, 2:4] = True
    cached = {0: {1: mask_a, 2: mask_b}}

    req = ExportRequest.model_validate(
        {
            "formats": ["coco_instance"],
            "object_meta": [
                {"obj_id": 1, "class_name": "cow", "instance_name": "cow_1"},
                {"obj_id": 2, "class_name": "cow", "instance_name": "cow_2"},
            ],
            "merge": {"mode": "destructive_export", "groups": [{"name": "herd", "obj_ids": [1, 2]}]},
            "scope": {"frame_start": 0, "frame_end": 0, "include_images": False},
            "auto_propagate_if_incomplete": False,
        }
    )

    archive = build_export_archive(record=record, cached_frame_outputs=cached, req=req)
    with zipfile.ZipFile(io.BytesIO(archive), "r") as zf:
        coco = json.loads(zf.read("annotations/coco_instances.json"))
        annotations = coco["annotations"]
        assert len(annotations) == 1
        assert coco["categories"][0]["name"] == "herd"

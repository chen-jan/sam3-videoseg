from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.mask_codec import mask_to_coco_rle
from app.models import ExportRequest
from app.session_store import SessionRecord

try:
    import torch
except Exception:  # pragma: no cover
    torch = None

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None


@dataclass(frozen=True)
class ResolvedObjectMeta:
    class_name: str
    instance_name: str


@dataclass(frozen=True)
class MergeGroupDef:
    synthetic_obj_id: int
    name: str
    obj_ids: tuple[int, ...]


def _to_bool_mask(mask_obj: object) -> np.ndarray:
    if torch is not None and isinstance(mask_obj, torch.Tensor):
        arr = mask_obj.detach().to("cpu").numpy()
    else:
        arr = np.asarray(mask_obj)
    if arr.ndim == 3:
        arr = arr[0]
    return arr.astype(bool)


def _bbox_xywh(mask: np.ndarray) -> list[float]:
    ys, xs = np.where(mask)
    if len(xs) == 0 or len(ys) == 0:
        return [0.0, 0.0, 0.0, 0.0]
    x_min = float(xs.min())
    y_min = float(ys.min())
    x_max = float(xs.max())
    y_max = float(ys.max())
    return [x_min, y_min, x_max - x_min + 1.0, y_max - y_min + 1.0]


def _mask_to_yolo_polygon(mask: np.ndarray, width: int, height: int) -> list[float]:
    width = max(1, width)
    height = max(1, height)
    if cv2 is not None:
        mask_u8 = (mask.astype(np.uint8) * 255).copy()
        contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            contour = max(contours, key=cv2.contourArea).reshape(-1, 2)
            if contour.shape[0] >= 3:
                coords: list[float] = []
                for x, y in contour:
                    coords.append(float(x) / width)
                    coords.append(float(y) / height)
                return coords

    x, y, w, h = _bbox_xywh(mask)
    x1 = x / width
    y1 = y / height
    x2 = (x + w) / width
    y2 = (y + h) / height
    return [x1, y1, x2, y1, x2, y2, x1, y2]


def _resolve_frame_bounds(record: SessionRecord, req: ExportRequest) -> tuple[int, int]:
    start = req.scope.frame_start if req.scope.frame_start is not None else 0
    end = req.scope.frame_end if req.scope.frame_end is not None else record.num_frames - 1
    start = max(0, min(start, record.num_frames - 1))
    end = max(0, min(end, record.num_frames - 1))
    if start > end:
        raise ValueError("frame_start cannot be greater than frame_end")
    return start, end


def _build_meta_map(req: ExportRequest) -> dict[int, ResolvedObjectMeta]:
    mapping: dict[int, ResolvedObjectMeta] = {}
    for item in req.object_meta:
        class_name = item.class_name.strip() or "object"
        instance_name = item.instance_name.strip()
        if not instance_name:
            instance_name = f"obj_{item.obj_id}"
        mapping[item.obj_id] = ResolvedObjectMeta(
            class_name=class_name, instance_name=instance_name
        )
    return mapping


def _build_merge_defs(req: ExportRequest) -> list[MergeGroupDef]:
    defs: list[MergeGroupDef] = []
    next_id = 2_000_000_000
    for group in req.merge.groups:
        obj_ids = tuple(dict.fromkeys(group.obj_ids))
        if len(obj_ids) == 0:
            continue
        defs.append(
            MergeGroupDef(
                synthetic_obj_id=next_id,
                name=group.name.strip() or f"group_{next_id}",
                obj_ids=obj_ids,
            )
        )
        next_id += 1
    return defs


def _apply_merge_mode(
    frame_masks: dict[int, np.ndarray],
    mode: str,
    merge_defs: list[MergeGroupDef],
) -> dict[int, np.ndarray]:
    if mode == "none" or len(merge_defs) == 0:
        return frame_masks

    grouped_obj_ids = {obj_id for g in merge_defs for obj_id in g.obj_ids}
    merged_masks: dict[int, np.ndarray] = {}

    if mode == "group":
        merged_masks.update(frame_masks)
    else:
        for obj_id, mask in frame_masks.items():
            if obj_id not in grouped_obj_ids:
                merged_masks[obj_id] = mask

    for group in merge_defs:
        combined: np.ndarray | None = None
        for obj_id in group.obj_ids:
            mask = frame_masks.get(obj_id)
            if mask is None:
                continue
            combined = mask.copy() if combined is None else np.logical_or(combined, mask)
        if combined is not None and np.any(combined):
            merged_masks[group.synthetic_obj_id] = combined

    return merged_masks


def build_export_archive(
    *,
    record: SessionRecord,
    cached_frame_outputs: dict[int, dict[int, object]],
    req: ExportRequest,
) -> bytes:
    start_frame, end_frame = _resolve_frame_bounds(record, req)
    meta_by_obj_id = _build_meta_map(req)
    merge_defs = _build_merge_defs(req)
    for group in merge_defs:
        meta_by_obj_id[group.synthetic_obj_id] = ResolvedObjectMeta(
            class_name=group.name,
            instance_name=group.name,
        )

    frames = list(range(start_frame, end_frame + 1))
    frame_masks_merged: dict[int, dict[int, np.ndarray]] = {}
    for frame_idx in frames:
        raw = cached_frame_outputs.get(frame_idx, {})
        frame_masks = {obj_id: _to_bool_mask(mask) for obj_id, mask in raw.items()}
        frame_masks_merged[frame_idx] = _apply_merge_mode(
            frame_masks, req.merge.mode, merge_defs
        )

    category_id_by_name: dict[str, int] = {}
    for per_frame in frame_masks_merged.values():
        for obj_id in per_frame:
            meta = meta_by_obj_id.get(
                obj_id,
                ResolvedObjectMeta(class_name="object", instance_name=f"obj_{obj_id}"),
            )
            if meta.class_name not in category_id_by_name:
                category_id_by_name[meta.class_name] = len(category_id_by_name) + 1

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        if req.scope.include_images:
            for frame_idx in frames:
                frame_path = Path(record.frames_dir) / f"{frame_idx:06d}.jpg"
                if frame_path.exists():
                    zf.write(frame_path, arcname=f"images/{frame_idx:06d}.jpg")

        if "coco_instance" in req.formats:
            coco_images: list[dict[str, object]] = []
            coco_annotations: list[dict[str, object]] = []
            ann_id = 1
            for frame_idx in frames:
                coco_images.append(
                    {
                        "id": frame_idx + 1,
                        "file_name": f"{frame_idx:06d}.jpg",
                        "width": int(record.width),
                        "height": int(record.height),
                    }
                )
                for obj_id, mask in frame_masks_merged[frame_idx].items():
                    if not np.any(mask):
                        continue
                    meta = meta_by_obj_id.get(
                        obj_id,
                        ResolvedObjectMeta(
                            class_name="object", instance_name=f"obj_{obj_id}"
                        ),
                    )
                    coco_annotations.append(
                        {
                            "id": ann_id,
                            "image_id": frame_idx + 1,
                            "category_id": category_id_by_name[meta.class_name],
                            "segmentation": mask_to_coco_rle(mask),
                            "area": int(mask.sum()),
                            "bbox": _bbox_xywh(mask),
                            "iscrowd": 0,
                            "sam3_obj_id": int(obj_id),
                            "instance_name": meta.instance_name,
                        }
                    )
                    ann_id += 1

            coco_categories = [
                {"id": cat_id, "name": name}
                for name, cat_id in category_id_by_name.items()
            ]
            coco_payload = {
                "images": coco_images,
                "annotations": coco_annotations,
                "categories": coco_categories,
            }
            zf.writestr(
                "annotations/coco_instances.json",
                json.dumps(coco_payload, indent=2),
            )

        if "yolo_segmentation" in req.formats:
            class_names = [None] * len(category_id_by_name)
            for name, cat_id in category_id_by_name.items():
                class_names[cat_id - 1] = name
            zf.writestr("annotations/yolo/classes.txt", "\n".join(class_names) + "\n")

            width = max(1, int(record.width))
            height = max(1, int(record.height))
            for frame_idx in frames:
                lines: list[str] = []
                for obj_id, mask in frame_masks_merged[frame_idx].items():
                    if not np.any(mask):
                        continue
                    meta = meta_by_obj_id.get(
                        obj_id,
                        ResolvedObjectMeta(
                            class_name="object", instance_name=f"obj_{obj_id}"
                        ),
                    )
                    class_idx = category_id_by_name[meta.class_name] - 1
                    polygon = _mask_to_yolo_polygon(mask, width, height)
                    if len(polygon) < 6:
                        continue
                    line = f"{class_idx} " + " ".join(f"{value:.6f}" for value in polygon)
                    lines.append(line)
                zf.writestr(
                    f"annotations/yolo/labels/{frame_idx:06d}.txt", "\n".join(lines) + "\n"
                )

        if "binary_masks_png" in req.formats:
            from PIL import Image

            for frame_idx in frames:
                for obj_id, mask in frame_masks_merged[frame_idx].items():
                    if not np.any(mask):
                        continue
                    png_buf = io.BytesIO()
                    Image.fromarray(mask.astype(np.uint8) * 255, mode="L").save(
                        png_buf, format="PNG"
                    )
                    zf.writestr(
                        f"masks/{frame_idx:06d}/obj_{obj_id}.png", png_buf.getvalue()
                    )

        manifest = {
            "session_id": record.session_id,
            "frame_range": [start_frame, end_frame],
            "num_frames": len(frames),
            "formats": req.formats,
            "merge_mode": req.merge.mode,
            "merge_groups": [
                {"name": g.name, "obj_ids": list(g.obj_ids), "synthetic_obj_id": g.synthetic_obj_id}
                for g in merge_defs
            ],
            "categories": [
                {"id": cat_id, "name": name}
                for name, cat_id in category_id_by_name.items()
            ],
            "object_meta": [
                {
                    "obj_id": obj_id,
                    "class_name": meta.class_name,
                    "instance_name": meta.instance_name,
                }
                for obj_id, meta in sorted(meta_by_obj_id.items(), key=lambda x: x[0])
            ],
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    zip_buffer.seek(0)
    return zip_buffer.getvalue()

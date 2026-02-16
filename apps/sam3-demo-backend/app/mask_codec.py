from __future__ import annotations

import numpy as np
from pycocotools import mask as mask_utils


def mask_to_coco_rle(mask: np.ndarray) -> dict[str, object]:
    mask_u8 = np.asfortranarray(mask.astype(np.uint8))
    encoded = mask_utils.encode(mask_u8)
    if isinstance(encoded, list):
        encoded = encoded[0]
    counts = encoded["counts"]
    if isinstance(counts, bytes):
        counts = counts.decode("utf-8")
    return {
        "size": [int(encoded["size"][0]), int(encoded["size"][1])],
        "counts": str(counts),
    }


def encode_sam3_outputs(outputs: dict[str, object]) -> list[dict[str, object]]:
    obj_ids = np.asarray(outputs.get("out_obj_ids", []), dtype=np.int64)
    scores = np.asarray(outputs.get("out_probs", []), dtype=np.float32)
    boxes = np.asarray(outputs.get("out_boxes_xywh", []), dtype=np.float32)
    masks = np.asarray(outputs.get("out_binary_masks", []), dtype=bool)

    n = min(len(obj_ids), len(scores), len(boxes), len(masks))
    encoded: list[dict[str, object]] = []
    for i in range(n):
        mask = masks[i]
        if mask.ndim == 3:
            mask = mask[0]
        rle = mask_to_coco_rle(mask)
        encoded.append(
            {
                "obj_id": int(obj_ids[i]),
                "score": float(scores[i]),
                "bbox_xywh": [float(v) for v in boxes[i].tolist()],
                "mask_rle": rle,
            }
        )
    return encoded

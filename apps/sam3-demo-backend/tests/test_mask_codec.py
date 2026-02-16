import numpy as np

from app.mask_codec import encode_sam3_outputs


def test_encode_sam3_outputs_with_single_mask() -> None:
    mask = np.zeros((4, 5), dtype=bool)
    mask[1:3, 2:4] = True

    outputs = {
        "out_obj_ids": np.array([7], dtype=np.int64),
        "out_probs": np.array([0.91], dtype=np.float32),
        "out_boxes_xywh": np.array([[0.1, 0.2, 0.3, 0.4]], dtype=np.float32),
        "out_binary_masks": np.array([mask], dtype=bool),
    }

    encoded = encode_sam3_outputs(outputs)
    assert len(encoded) == 1
    obj = encoded[0]
    assert obj["obj_id"] == 7
    assert abs(obj["score"] - 0.91) < 1e-6
    assert len(obj["bbox_xywh"]) == 4
    assert obj["mask_rle"]["size"] == [4, 5]
    assert isinstance(obj["mask_rle"]["counts"], str)


def test_encode_sam3_outputs_with_empty_payload() -> None:
    encoded = encode_sam3_outputs({})
    assert encoded == []

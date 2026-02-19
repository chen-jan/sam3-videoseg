from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class MaskRLE(BaseModel):
    size: list[int]
    counts: str


class ObjectOutput(BaseModel):
    obj_id: int
    score: float
    bbox_xywh: list[float]
    mask_rle: MaskRLE


class PointInput(BaseModel):
    x: float
    y: float
    label: Literal[0, 1]


class UploadResponse(BaseModel):
    session_id: str
    num_frames: int
    width: int
    height: int
    source_fps: float
    processing_fps: float
    source_duration_sec: float
    processing_num_frames: int


class TextPromptRequest(BaseModel):
    frame_index: int = Field(ge=0)
    text: str = Field(min_length=1)
    reset_first: bool = True


class ClickPromptRequest(BaseModel):
    frame_index: int = Field(ge=0)
    obj_id: int
    points: list[PointInput]


class PromptResponse(BaseModel):
    frame_index: int
    objects: list[ObjectOutput]


class CreateObjectResponse(BaseModel):
    obj_id: int


class OperationResponse(BaseModel):
    ok: bool = True


class PropagationStartMessage(BaseModel):
    action: Literal["start"]
    direction: Literal["both", "forward", "backward"] = "both"
    start_frame_index: int | None = None


ExportFormat = Literal["coco_instance", "yolo_segmentation", "binary_masks_png"]
MergeMode = Literal["none", "group", "destructive_export"]


class ExportObjectMeta(BaseModel):
    obj_id: int
    class_name: str = Field(min_length=1, default="object")
    instance_name: str = ""


class ExportMergeGroup(BaseModel):
    name: str = Field(min_length=1)
    obj_ids: list[int] = Field(default_factory=list)


class ExportMergeConfig(BaseModel):
    mode: MergeMode = "none"
    groups: list[ExportMergeGroup] = Field(default_factory=list)


class ExportScope(BaseModel):
    frame_start: int | None = Field(default=None, ge=0)
    frame_end: int | None = Field(default=None, ge=0)
    include_images: bool = True


class ExportRequest(BaseModel):
    formats: list[ExportFormat] = Field(default_factory=lambda: ["coco_instance"])
    object_meta: list[ExportObjectMeta] = Field(default_factory=list)
    merge: ExportMergeConfig = Field(default_factory=ExportMergeConfig)
    scope: ExportScope = Field(default_factory=ExportScope)
    auto_propagate_if_incomplete: bool = False

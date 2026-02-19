export type ClickMode = "positive" | "negative";

export interface MaskRLE {
  size: [number, number] | number[];
  counts: string;
}

export interface ObjectOutput {
  obj_id: number;
  score: number;
  bbox_xywh: [number, number, number, number] | number[];
  mask_rle: MaskRLE;
}

export interface PointInput {
  x: number;
  y: number;
  label: 0 | 1;
}

export interface UploadResponse {
  session_id: string;
  num_frames: number;
  width: number;
  height: number;
  source_fps: number;
  processing_fps: number;
  source_duration_sec: number;
  processing_num_frames: number;
}

export interface TextPromptRequest {
  frame_index: number;
  text: string;
  reset_first: boolean;
}

export interface ClickPromptRequest {
  frame_index: number;
  obj_id: number;
  points: PointInput[];
}

export interface PromptResponse {
  frame_index: number;
  objects: ObjectOutput[];
}

export interface CreateObjectResponse {
  obj_id: number;
}

export interface OperationResponse {
  ok: boolean;
}

export interface TrackedObject {
  objId: number;
  color: string;
  visible: boolean;
  className: string;
  instanceName: string;
}

export interface PropagationStart {
  direction: "both" | "forward" | "backward";
  start_frame_index: number | null;
}

export interface PropagationFrameEvent {
  type: "propagation_frame";
  frame_index: number;
  objects: ObjectOutput[];
}

export interface WsErrorPayload {
  type?: string;
  code: string;
  message: string;
  details?: string;
  request_id?: string;
}

export interface AppErrorInfo {
  code: string;
  message: string;
  details?: string;
  request_id?: string;
  status?: number;
  context?: string;
  ts: string;
}

export type ExportFormat = "coco_instance" | "yolo_segmentation" | "binary_masks_png";
export type MergeMode = "none" | "group" | "destructive_export";

export interface ExportObjectMeta {
  obj_id: number;
  class_name: string;
  instance_name: string;
}

export interface ExportMergeGroup {
  name: string;
  obj_ids: number[];
}

export interface ExportRequest {
  formats: ExportFormat[];
  object_meta: ExportObjectMeta[];
  merge: {
    mode: MergeMode;
    groups: ExportMergeGroup[];
  };
  scope: {
    frame_start: number | null;
    frame_end: number | null;
    include_images: boolean;
  };
  auto_propagate_if_incomplete: boolean;
}

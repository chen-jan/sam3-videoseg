import { ExportFormat, MergeMode } from "../lib/types";

interface ExportPanelProps {
  disabled: boolean;
  isExporting: boolean;
  formats: Record<ExportFormat, boolean>;
  mergeMode: MergeMode;
  mergeGroupsText: string;
  frameStart: string;
  frameEnd: string;
  includeImages: boolean;
  autoPropagate: boolean;
  onFormatChange: (format: ExportFormat, checked: boolean) => void;
  onMergeModeChange: (mode: MergeMode) => void;
  onMergeGroupsTextChange: (text: string) => void;
  onFrameStartChange: (value: string) => void;
  onFrameEndChange: (value: string) => void;
  onIncludeImagesChange: (value: boolean) => void;
  onAutoPropagateChange: (value: boolean) => void;
  onDownload: () => void;
}

export function ExportPanel({
  disabled,
  isExporting,
  formats,
  mergeMode,
  mergeGroupsText,
  frameStart,
  frameEnd,
  includeImages,
  autoPropagate,
  onFormatChange,
  onMergeModeChange,
  onMergeGroupsTextChange,
  onFrameStartChange,
  onFrameEndChange,
  onIncludeImagesChange,
  onAutoPropagateChange,
  onDownload,
}: ExportPanelProps) {
  const selectedCount = (Object.keys(formats) as ExportFormat[]).filter(
    (format) => formats[format]
  ).length;

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Export settings ({selectedCount} format{selectedCount === 1 ? "" : "s"})
        </summary>

        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <span>Formats</span>
            <label>
              <input
                type="checkbox"
                checked={formats.coco_instance}
                onChange={(e) => onFormatChange("coco_instance", e.target.checked)}
              />{" "}
              COCO instance
            </label>
            <label>
              <input
                type="checkbox"
                checked={formats.yolo_segmentation}
                onChange={(e) => onFormatChange("yolo_segmentation", e.target.checked)}
              />{" "}
              YOLO segmentation
            </label>
            <label>
              <input
                type="checkbox"
                checked={formats.binary_masks_png}
                onChange={(e) => onFormatChange("binary_masks_png", e.target.checked)}
              />{" "}
              Binary mask PNGs
            </label>
          </div>

          <label style={{ display: "grid", gap: 4 }}>
            <span>Merge mode</span>
            <select value={mergeMode} onChange={(e) => onMergeModeChange(e.target.value as MergeMode)}>
              <option value="none">None</option>
              <option value="group">Group (non-destructive)</option>
              <option value="destructive_export">Destructive export merge</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span>Merge groups (one per line: group_name: id1,id2,...)</span>
            <textarea
              rows={4}
              value={mergeGroupsText}
              onChange={(e) => onMergeGroupsTextChange(e.target.value)}
              placeholder={"herd: -1,-2,-3\nall_cows: 4,5,6"}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Frame start</span>
              <input
                type="number"
                min={0}
                value={frameStart}
                onChange={(e) => onFrameStartChange(e.target.value)}
                placeholder="0"
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Frame end</span>
              <input
                type="number"
                min={0}
                value={frameEnd}
                onChange={(e) => onFrameEndChange(e.target.value)}
                placeholder="last"
              />
            </label>
          </div>

          <label>
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(e) => onIncludeImagesChange(e.target.checked)}
            />{" "}
            Include extracted frame images
          </label>
          <label>
            <input
              type="checkbox"
              checked={autoPropagate}
              onChange={(e) => onAutoPropagateChange(e.target.checked)}
            />{" "}
            Auto-propagate missing cached frames before export
          </label>

          <small style={{ color: "#666", lineHeight: 1.4 }}>
            Group mode keeps original instances and also adds merged group masks. Destructive
            export mode replaces grouped member instances with merged groups in export output.
          </small>
        </div>
      </details>

      <button onClick={onDownload} disabled={disabled || isExporting} style={{ marginTop: 10 }}>
        {isExporting ? "Preparing export..." : "Download Export ZIP"}
      </button>
    </div>
  );
}

import { ClickMode } from "../lib/types";

interface PropagationProgress {
  completed: number;
  total: number;
  percent: number;
}

interface PromptPanelProps {
  textPrompt: string;
  selectedObjId: number | null;
  clickMode: ClickMode;
  isPropagating: boolean;
  propagationProgress: PropagationProgress | null;
  status: string;
  onTextPromptChange: (value: string) => void;
  onSubmitTextPrompt: () => void;
  onAddObject: () => void;
  onRunPropagation: () => void;
  onReset: () => void;
  onClickModeChange: (mode: ClickMode) => void;
}

export function PromptPanel({
  textPrompt,
  selectedObjId,
  clickMode,
  isPropagating,
  propagationProgress,
  status,
  onTextPromptChange,
  onSubmitTextPrompt,
  onAddObject,
  onRunPropagation,
  onReset,
  onClickModeChange,
}: PromptPanelProps) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Prompt Controls</h3>
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Text Prompt</span>
          <input
            type="text"
            value={textPrompt}
            onChange={(event) => onTextPromptChange(event.target.value)}
            placeholder="e.g. person in red shirt"
          />
          <small style={{ color: "#666" }}>
            Text prompt adds/updates detections; it is not guaranteed add-only.
          </small>
        </label>
        <button onClick={onSubmitTextPrompt}>Apply Text Prompt</button>
        <button onClick={onAddObject}>+ Add Object (for click prompts)</button>

        <div style={{ display: "grid", gap: 4 }}>
          <span>Click Mode (left-click)</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => onClickModeChange("positive")}
              style={{
                background: clickMode === "positive" ? "#dbeafe" : "transparent",
              }}
            >
              Positive
            </button>
            <button
              onClick={() => onClickModeChange("negative")}
              style={{
                background: clickMode === "negative" ? "#fee2e2" : "transparent",
              }}
            >
              Negative
            </button>
          </div>
          <small style={{ color: "#666" }}>
            Right-click is always negative. Selected object: {selectedObjId ?? "none"}
          </small>
        </div>

        <small style={{ color: "#666", lineHeight: 1.4 }}>
          Propagation runs across the full video in both directions.
        </small>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onRunPropagation} disabled={isPropagating}>
            {isPropagating ? "Propagating..." : "Run Propagation"}
          </button>
          <button onClick={onReset}>Reset Session</button>
        </div>

        {propagationProgress !== null ? (
          <div style={{ display: "grid", gap: 4 }}>
            <small style={{ color: "#666" }}>
              Progress: {propagationProgress.completed}/{propagationProgress.total} frames (
              {Math.round(propagationProgress.percent)}%)
            </small>
            <div
              style={{
                width: "100%",
                height: 8,
                borderRadius: 999,
                background: "#e5e7eb",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, propagationProgress.percent))}%`,
                  height: "100%",
                  background: "#2563eb",
                  transition: "width 120ms linear",
                }}
              />
            </div>
          </div>
        ) : null}

        <small style={{ color: "#666", lineHeight: 1.4 }}>
          Click prompt flow: 1) Press "+ Add Object" 2) Left-click positive / right-click
          negative points on the image 3) Run Propagation. Manual click objects use negative
          ids by design.
        </small>

        <div style={{ minHeight: 24, color: "#374151" }}>{status}</div>
      </div>
    </div>
  );
}

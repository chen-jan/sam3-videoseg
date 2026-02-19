import { ClickMode } from "../lib/types";

interface PromptPanelProps {
  textPrompt: string;
  selectedObjId: number | null;
  clickMode: ClickMode;
  isPropagating: boolean;
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

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onRunPropagation} disabled={isPropagating}>
            {isPropagating ? "Propagating..." : "Run Propagation"}
          </button>
          <button onClick={onReset}>Reset Session</button>
        </div>

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

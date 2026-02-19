import { AppErrorInfo, ClickMode } from "../lib/types";

interface PromptPanelProps {
  textPrompt: string;
  selectedObjId: number | null;
  clickMode: ClickMode;
  isPropagating: boolean;
  status: string;
  latestError: AppErrorInfo | null;
  errorHistory: AppErrorInfo[];
  onTextPromptChange: (value: string) => void;
  onSubmitTextPrompt: () => void;
  onAddObject: () => void;
  onRunPropagation: () => void;
  onReset: () => void;
  onClickModeChange: (mode: ClickMode) => void;
}

function ErrorPanel({ latestError, history }: { latestError: AppErrorInfo | null; history: AppErrorInfo[] }) {
  if (!latestError) {
    return null;
  }

  return (
    <div style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 10, background: "#fff1f2" }}>
      <div style={{ fontWeight: 600, color: "#991b1b", marginBottom: 6 }}>Latest Error</div>
      <div style={{ fontFamily: "monospace", fontSize: 12, color: "#7f1d1d" }}>
        <div>
          [{latestError.code}] {latestError.message}
        </div>
        {latestError.details ? <div>{latestError.details}</div> : null}
        {latestError.request_id ? <div>request_id: {latestError.request_id}</div> : null}
      </div>
      {history.length > 1 ? (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", color: "#7f1d1d" }}>
            Error history ({history.length})
          </summary>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {history.map((err, idx) => (
              <div
                key={`${err.ts}-${idx}`}
                style={{
                  border: "1px solid #fecdd3",
                  borderRadius: 6,
                  padding: 6,
                  background: "#fff",
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: "#881337",
                }}
              >
                <div>{err.ts}</div>
                <div>
                  [{err.code}] {err.message}
                </div>
                {err.context ? <div>context: {err.context}</div> : null}
                {err.request_id ? <div>request_id: {err.request_id}</div> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function PromptPanel({
  textPrompt,
  selectedObjId,
  clickMode,
  isPropagating,
  status,
  latestError,
  errorHistory,
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

        <small style={{ color: "#666", lineHeight: 1.4 }}>
          Propagation runs across the full video in both directions.
        </small>

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

        <ErrorPanel latestError={latestError} history={errorHistory} />
      </div>
    </div>
  );
}

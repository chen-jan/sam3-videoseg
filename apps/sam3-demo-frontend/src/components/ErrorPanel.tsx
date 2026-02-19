import { AppErrorInfo } from "../lib/types";

interface ErrorPanelProps {
  latestError: AppErrorInfo | null;
  history: AppErrorInfo[];
}

export function ErrorPanel({ latestError, history }: ErrorPanelProps) {
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

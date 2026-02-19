import { useEffect, useMemo, useState } from "react";

import { StorageStatusResponse, StoredVideoInfo } from "../lib/types";

interface StoragePanelProps {
  isOpen: boolean;
  isBusy: boolean;
  status: StorageStatusResponse | null;
  videos: StoredVideoInfo[];
  selectedVideoIds: string[];
  activeVideoId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onToggleSelect: (videoId: string) => void;
  onSelectAll: (checked: boolean) => void;
  onLoad: (videoId: string) => void;
  onRename: (videoId: string, displayName: string) => void;
  onDeleteSelected: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const precision = idx <= 1 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}

export function StoragePanel({
  isOpen,
  isBusy,
  status,
  videos,
  selectedVideoIds,
  activeVideoId,
  onClose,
  onRefresh,
  onToggleSelect,
  onSelectAll,
  onLoad,
  onRename,
  onDeleteSelected,
}: StoragePanelProps) {
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const selectedSet = useMemo(() => new Set(selectedVideoIds), [selectedVideoIds]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const video of videos) {
      next[video.video_id] = video.display_name;
    }
    setNameDrafts(next);
  }, [videos]);

  if (!isOpen) {
    return null;
  }

  const allChecked = videos.length > 0 && selectedVideoIds.length === videos.length;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "grid",
        placeItems: "center",
        padding: 17,
        zIndex: 1100,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(980px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          padding: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Storage</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onRefresh} disabled={isBusy}>
              Refresh
            </button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        <div style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 600 }}>Server storage</div>
          {status === null ? (
            <div style={{ color: "#6b7280" }}>No storage data available yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <div>Root: <code>{status.storage_root}</code></div>
              <div>Total: {formatBytes(status.total_bytes)}</div>
              <div>Used: {formatBytes(status.used_bytes)}</div>
              <div>Free: {formatBytes(status.free_bytes)}</div>
              <div>Videos: {status.uploads_count} ({formatBytes(status.uploads_bytes)})</div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(event) => onSelectAll(event.target.checked)}
              disabled={videos.length === 0}
            />
            Select all
          </label>
          <button
            onClick={onDeleteSelected}
            disabled={selectedVideoIds.length === 0 || isBusy}
            style={{
              borderColor: "#fecaca",
              color: "#991b1b",
            }}
          >
            Delete selected ({selectedVideoIds.length})
          </button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {videos.length === 0 ? (
            <div style={{ color: "#6b7280" }}>No stored videos found.</div>
          ) : (
            videos.map((video) => {
              const isSelected = selectedSet.has(video.video_id);
              const isActive = activeVideoId !== null && activeVideoId === video.video_id;
              const draft = nameDrafts[video.video_id] ?? video.display_name;
              return (
                <div
                  key={video.video_id}
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    padding: 10,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(video.video_id)}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                        <span>{video.display_name}</span>
                        {isActive ? (
                          <span style={{ fontSize: 11, color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 999, padding: "1px 7px" }}>
                            Active
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {video.file_name} - {formatBytes(video.size_bytes)} - updated {new Date(video.updated_at).toLocaleString()}
                      </div>
                    </div>
                    <button onClick={() => onLoad(video.video_id)} disabled={isBusy}>
                      Load
                    </button>
                    <button
                      onClick={() => onRename(video.video_id, draft)}
                      disabled={isBusy || draft.trim().length === 0 || draft.trim() === video.display_name}
                    >
                      Rename
                    </button>
                  </div>
                  <input
                    type="text"
                    value={draft}
                    onChange={(event) =>
                      setNameDrafts((prev) => ({ ...prev, [video.video_id]: event.target.value }))
                    }
                    placeholder="Display name"
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

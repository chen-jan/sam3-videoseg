import { TrackedObject } from "../lib/types";

interface ObjectListProps {
  objects: TrackedObject[];
  selectedObjId: number | null;
  onSelect: (objId: number) => void;
  onToggleVisibility: (objId: number) => void;
  onRemove: (objId: number) => void;
  onRenameClass: (objId: number, className: string) => void;
  onRenameInstance: (objId: number, instanceName: string) => void;
}

export function ObjectList({
  objects,
  selectedObjId,
  onSelect,
  onToggleVisibility,
  onRemove,
  onRenameClass,
  onRenameInstance,
}: ObjectListProps) {
  const objectLabel = (object: TrackedObject) => {
    const name = object.className.trim() || object.instanceName.trim();
    if (name.length > 0) {
      return `${name} (id ${object.objId})`;
    }
    return object.objId < 0
      ? `Manual ${Math.abs(object.objId)} (id ${object.objId})`
      : `Detected ${object.objId}`;
  };

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: 12,
        height: 360,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: 10,
      }}
    >
      <h3 style={{ marginTop: 0 }}>Objects</h3>
      {objects.length === 0 ? (
        <p style={{ margin: 0, color: "#666" }}>No objects yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 8, overflowY: "auto", paddingRight: 4 }}>
          {objects.map((object) => (
            <div
              key={object.objId}
              style={{
                display: "grid",
                gap: 8,
                padding: 8,
                borderRadius: 6,
                border:
                  selectedObjId === object.objId
                    ? "2px solid #1d4ed8"
                    : "1px solid #ddd",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px 1fr auto auto auto",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: object.color,
                  }}
                />
                <button
                  onClick={() => onSelect(object.objId)}
                  style={{
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                  title={`Raw object id: ${object.objId}`}
                >
                  {objectLabel(object)}
                </button>
                {selectedObjId === object.objId ? (
                  <span style={{ color: "#1d4ed8", fontSize: 12, fontWeight: 600 }}>
                    Selected
                  </span>
                ) : (
                  <span />
                )}
                <button onClick={() => onToggleVisibility(object.objId)}>
                  {object.visible ? "Hide" : "Show"}
                </button>
                <button onClick={() => onRemove(object.objId)}>Remove</button>
              </div>

              <details>
                <summary style={{ cursor: "pointer", fontSize: 13, color: "#334155" }}>
                  Rename labels
                </summary>
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "#666" }}>Class name</span>
                    <input
                      value={object.className}
                      onChange={(event) => onRenameClass(object.objId, event.target.value)}
                      placeholder="e.g. cow"
                    />
                  </label>

                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "#666" }}>Instance name</span>
                    <input
                      value={object.instanceName}
                      onChange={(event) => onRenameInstance(object.objId, event.target.value)}
                      placeholder="e.g. cow_left_1"
                    />
                  </label>
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

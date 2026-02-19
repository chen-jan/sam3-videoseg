"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  addClickPrompt,
  addTextPrompt,
  buildFrameUrl,
  createObject,
  deleteSession,
  exportSession,
  openPropagationSocket,
  removeObject,
  resetSession,
  uploadVideo,
} from "../lib/api";
import {
  AppErrorInfo,
  ClickMode,
  ExportFormat,
  ExportRequest,
  MergeMode,
  ObjectOutput,
  PointInput,
  PromptResponse,
  TrackedObject,
  UploadResponse,
  WsErrorPayload,
} from "../lib/types";
import { ObjectList } from "../components/ObjectList";
import { PlaybackControls } from "../components/PlaybackControls";
import { PromptPanel } from "../components/PromptPanel";
import { VideoCanvas } from "../components/VideoCanvas";
import { ExportPanel } from "../components/ExportPanel";
import { ErrorPanel } from "../components/ErrorPanel";

const COLORS = [
  "#ff5733",
  "#0077b6",
  "#2a9d8f",
  "#f4a261",
  "#8338ec",
  "#ef476f",
  "#118ab2",
  "#06d6a0",
  "#ff9f1c",
  "#4d908e",
  "#577590",
  "#f72585",
];

function colorForObjId(objId: number): string {
  return COLORS[Math.abs(objId) % COLORS.length];
}

function nowIso(): string {
  return new Date().toISOString();
}

function toAppError(error: unknown, context?: string): AppErrorInfo {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      request_id: error.requestId,
      status: error.status,
      context,
      ts: nowIso(),
    };
  }
  if (typeof error === "object" && error !== null) {
    const maybe = error as Record<string, unknown>;
    return {
      code: typeof maybe.code === "string" ? maybe.code : "UNKNOWN_ERROR",
      message:
        typeof maybe.message === "string"
          ? maybe.message
          : error instanceof Error
            ? error.message
            : String(error),
      details: typeof maybe.details === "string" ? maybe.details : undefined,
      request_id: typeof maybe.request_id === "string" ? maybe.request_id : undefined,
      context,
      ts: nowIso(),
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error),
    context,
    ts: nowIso(),
  };
}

function parseMergeGroups(raw: string): { name: string; obj_ids: number[] }[] {
  const groups: { name: string; obj_ids: number[] }[] = [];
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) {
      throw new Error(`Invalid merge group line: \"${line}\"`);
    }
    const name = line.slice(0, colonIdx).trim();
    const idsRaw = line.slice(colonIdx + 1).trim();
    const ids = idsRaw
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .map((x) => Number(x));
    if (name.length === 0 || ids.length === 0 || ids.some((n) => !Number.isInteger(n))) {
      throw new Error(`Invalid merge group line: \"${line}\"`);
    }
    groups.push({ name, obj_ids: ids as number[] });
  }

  return groups;
}

export default function Page() {
  const [session, setSession] = useState<UploadResponse | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [maskCache, setMaskCache] = useState<Record<number, ObjectOutput[]>>({});
  const [objectsById, setObjectsById] = useState<Record<number, TrackedObject>>({});
  const [selectedObjId, setSelectedObjId] = useState<number | null>(null);
  const [clickMode, setClickMode] = useState<ClickMode>("positive");
  const [textPrompt, setTextPrompt] = useState("person");
  const [isPropagating, setIsPropagating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState("Upload a video to start.");
  const [latestError, setLatestError] = useState<AppErrorInfo | null>(null);
  const [errorHistory, setErrorHistory] = useState<AppErrorInfo[]>([]);
  const [lastClick, setLastClick] = useState<{
    x: number;
    y: number;
    label: 0 | 1;
    objId: number;
    frameIndex: number;
  } | null>(null);

  const [exportFormats, setExportFormats] = useState<Record<ExportFormat, boolean>>({
    coco_instance: true,
    yolo_segmentation: true,
    binary_masks_png: false,
  });
  const [mergeMode, setMergeMode] = useState<MergeMode>("none");
  const [mergeGroupsText, setMergeGroupsText] = useState("");
  const [exportFrameStart, setExportFrameStart] = useState("");
  const [exportFrameEnd, setExportFrameEnd] = useState("");
  const [exportIncludeImages, setExportIncludeImages] = useState(true);
  const [autoPropagateForExport, setAutoPropagateForExport] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const objects = useMemo(
    () => Object.values(objectsById).sort((a, b) => a.objId - b.objId),
    [objectsById]
  );

  const objectColors = useMemo(() => {
    const colorMap: Record<number, string> = {};
    for (const object of objects) {
      colorMap[object.objId] = object.color;
    }
    return colorMap;
  }, [objects]);

  const objectVisibility = useMemo(() => {
    const visibility: Record<number, boolean> = {};
    for (const object of objects) {
      visibility[object.objId] = object.visible;
    }
    return visibility;
  }, [objects]);

  const currentFrameObjects = maskCache[currentFrame] ?? [];
  const frameUrl =
    session === null
      ? null
      : buildFrameUrl(session.session_id, Math.max(0, currentFrame));

  const currentFrameLastClick =
    lastClick !== null && lastClick.frameIndex === currentFrame
      ? { x: lastClick.x, y: lastClick.y, label: lastClick.label, objId: lastClick.objId }
      : null;

  const pushError = (error: unknown, context?: string) => {
    const next = toAppError(error, context);
    setLatestError(next);
    setErrorHistory((prev) => [next, ...prev].slice(0, 20));
  };

  const closePropagationSocket = () => {
    if (wsRef.current !== null) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const upsertObjectsFromOutputs = (outputs: ObjectOutput[]) => {
    if (outputs.length === 0) {
      return;
    }
    setObjectsById((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const output of outputs) {
        if (next[output.obj_id] === undefined) {
          const manual = output.obj_id < 0;
          next[output.obj_id] = {
            objId: output.obj_id,
            color: colorForObjId(output.obj_id),
            visible: true,
            className: manual ? "manual_object" : "detected_object",
            instanceName: `obj_${output.obj_id}`,
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  const applyPromptResponse = (response: PromptResponse) => {
    setMaskCache((prev) => ({ ...prev, [response.frame_index]: response.objects }));
    upsertObjectsFromOutputs(response.objects);
    if (selectedObjId === null && response.objects.length > 0) {
      setSelectedObjId(response.objects[0].obj_id);
    }
  };

  const handleUpload = async (file: File) => {
    try {
      setStatus("Uploading and preprocessing video...");
      closePropagationSocket();
      if (session !== null) {
        await deleteSession(session.session_id);
      }
      const uploaded = await uploadVideo(file);
      setSession(uploaded);
      setCurrentFrame(0);
      setMaskCache({});
      setObjectsById({});
      setSelectedObjId(null);
      setIsPropagating(false);
      setIsPlaying(false);
      setLastClick(null);
      setStatus(
        `Ready: ${uploaded.processing_num_frames} frames @ ${uploaded.processing_fps.toFixed(2)} fps`
      );
    } catch (error) {
      pushError(error, "upload");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Upload failed: ${message}`);
    }
  };

  const handleSubmitTextPrompt = async () => {
    if (session === null) {
      return;
    }
    try {
      setStatus("Running text prompt...");
      const response = await addTextPrompt(session.session_id, {
        frame_index: currentFrame,
        text: textPrompt,
        reset_first: true,
      });
      applyPromptResponse(response);
      setStatus("Text prompt applied.");
    } catch (error) {
      pushError(error, "text_prompt");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Text prompt failed: ${message}`);
    }
  };

  const handleAddObject = async () => {
    if (session === null) {
      return;
    }
    try {
      const response = await createObject(session.session_id);
      const object: TrackedObject = {
        objId: response.obj_id,
        color: colorForObjId(response.obj_id),
        visible: true,
        className: "manual_object",
        instanceName: `manual_${Math.abs(response.obj_id)}`,
      };
      setObjectsById((prev) => ({ ...prev, [object.objId]: object }));
      setSelectedObjId(object.objId);
      setStatus(
        `Added manual object ${Math.abs(object.objId)} (id ${object.objId}). ` +
          `Now click on the image: left=positive, right=negative.`
      );
    } catch (error) {
      pushError(error, "add_object");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to add object: ${message}`);
    }
  };

  const handlePointPrompt = async (point: PointInput) => {
    if (session === null || selectedObjId === null) {
      setStatus("Select or create an object first.");
      return;
    }

    setLastClick({
      x: point.x,
      y: point.y,
      label: point.label,
      objId: selectedObjId,
      frameIndex: currentFrame,
    });

    try {
      const response = await addClickPrompt(session.session_id, {
        frame_index: currentFrame,
        obj_id: selectedObjId,
        points: [point],
      });
      applyPromptResponse(response);
      setStatus(
        `Applied ${point.label === 1 ? "positive" : "negative"} click on object ${selectedObjId}.`
      );
    } catch (error) {
      pushError(error, "click_prompt");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Click prompt failed: ${message}`);
    }
  };

  const handleRemoveObject = async (objId: number) => {
    if (session === null) {
      return;
    }
    try {
      await removeObject(session.session_id, objId);
      setObjectsById((prev) => {
        const next = { ...prev };
        delete next[objId];
        return next;
      });
      setMaskCache((prev) => {
        const next: Record<number, ObjectOutput[]> = {};
        for (const key of Object.keys(prev)) {
          const frame = Number(key);
          next[frame] = prev[frame].filter((object) => object.obj_id !== objId);
        }
        return next;
      });
      if (selectedObjId === objId) {
        setSelectedObjId(null);
      }
      setStatus(`Removed object ${objId}.`);
    } catch (error) {
      pushError(error, "remove_object");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Remove failed: ${message}`);
    }
  };

  const handleReset = async () => {
    if (session === null) {
      return;
    }
    try {
      closePropagationSocket();
      await resetSession(session.session_id);
      setMaskCache({});
      setObjectsById({});
      setSelectedObjId(null);
      setIsPropagating(false);
      setLastClick(null);
      setStatus("Session reset.");
    } catch (error) {
      pushError(error, "reset_session");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Reset failed: ${message}`);
    }
  };

  const handlePropagation = () => {
    if (session === null) {
      return;
    }

    closePropagationSocket();
    setIsPropagating(true);
    setStatus("Propagation started across the full video.");

    wsRef.current = openPropagationSocket(
      session.session_id,
      {
        direction: "both",
        start_frame_index: null,
      },
      {
        onFrame: (event) => {
          setMaskCache((prev) => ({ ...prev, [event.frame_index]: event.objects }));
          upsertObjectsFromOutputs(event.objects);
          setStatus(
            `Propagating... frame ${event.frame_index + 1}/${session.processing_num_frames}`
          );
        },
        onDone: () => {
          setIsPropagating(false);
          setStatus("Propagation complete.");
          closePropagationSocket();
        },
        onError: (event) => {
          setIsPropagating(false);
          if (event instanceof Error) {
            pushError(event, "propagation");
            setStatus(`Propagation error: ${event.message}`);
          } else {
            const wsErr = event as WsErrorPayload;
            pushError(
              {
                code: wsErr.code,
                message: wsErr.message,
                details: wsErr.details,
                request_id: wsErr.request_id,
              },
              "propagation"
            );
            setStatus(`Propagation error: ${wsErr.code}: ${wsErr.message}`);
          }
          closePropagationSocket();
        },
      }
    );
  };

  const handleDownloadExport = async () => {
    if (session === null) {
      return;
    }

    try {
      const selectedFormats = (Object.keys(exportFormats) as ExportFormat[]).filter(
        (format) => exportFormats[format]
      );
      if (selectedFormats.length === 0) {
        throw new Error("Select at least one export format.");
      }

      const mergeGroups = parseMergeGroups(mergeGroupsText);
      const frameStart = exportFrameStart.trim() === "" ? null : Number(exportFrameStart);
      const frameEnd = exportFrameEnd.trim() === "" ? null : Number(exportFrameEnd);
      if (
        (frameStart !== null && (!Number.isInteger(frameStart) || frameStart < 0)) ||
        (frameEnd !== null && (!Number.isInteger(frameEnd) || frameEnd < 0))
      ) {
        throw new Error("Export frame range must use integers >= 0.");
      }

      const request: ExportRequest = {
        formats: selectedFormats,
        object_meta: objects.map((obj) => ({
          obj_id: obj.objId,
          class_name: obj.className.trim() || "object",
          instance_name: obj.instanceName.trim() || `obj_${obj.objId}`,
        })),
        merge: {
          mode: mergeMode,
          groups: mergeGroups,
        },
        scope: {
          frame_start: frameStart,
          frame_end: frameEnd,
          include_images: exportIncludeImages,
        },
        auto_propagate_if_incomplete: autoPropagateForExport,
      };

      setIsExporting(true);
      setStatus("Preparing export archive...");
      const blob = await exportSession(session.session_id, request);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sam3-export-${session.session_id.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Export downloaded.");
    } catch (error) {
      pushError(error, "export");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Export failed: ${message}`);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (!isPlaying || session === null) {
      return;
    }
    const intervalMs = Math.max(10, Math.round(1000 / session.processing_fps));
    const timer = window.setInterval(() => {
      setCurrentFrame((prev) => {
        const next = prev + 1;
        if (next >= session.processing_num_frames) {
          return 0;
        }
        return next;
      });
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [isPlaying, session]);

  useEffect(() => {
    return () => {
      closePropagationSocket();
      if (session !== null) {
        void deleteSession(session.session_id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session_id]);

  return (
    <main style={{ padding: 17, display: "grid", gap: 14 }}>
      <h1 style={{ margin: 0 }}>SAM3 Single-User Demo</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 11 }}>
        <label style={{ display: "grid", gap: 7 }}>
          <span>Upload Video (max 60s, capped to 900 frames)</span>
          <input
            type="file"
            accept="video/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleUpload(file);
              }
            }}
          />
        </label>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px minmax(0, 1fr)",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 11, alignContent: "start" }}>
          <PromptPanel
            textPrompt={textPrompt}
            selectedObjId={selectedObjId}
            clickMode={clickMode}
            isPropagating={isPropagating}
            status={status}
            onTextPromptChange={setTextPrompt}
            onSubmitTextPrompt={() => void handleSubmitTextPrompt()}
            onAddObject={() => void handleAddObject()}
            onRunPropagation={handlePropagation}
            onReset={() => void handleReset()}
            onClickModeChange={setClickMode}
          />

          <ObjectList
            objects={objects}
            selectedObjId={selectedObjId}
            onSelect={setSelectedObjId}
            onToggleVisibility={(objId) => {
              setObjectsById((prev) => ({
                ...prev,
                [objId]: { ...prev[objId], visible: !prev[objId].visible },
              }));
            }}
            onRenameClass={(objId, className) => {
              setObjectsById((prev) => ({
                ...prev,
                [objId]: { ...prev[objId], className },
              }));
            }}
            onRenameInstance={(objId, instanceName) => {
              setObjectsById((prev) => ({
                ...prev,
                [objId]: { ...prev[objId], instanceName },
              }));
            }}
            onRemove={(objId) => void handleRemoveObject(objId)}
          />

          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 11, display: "grid", gap: 7 }}>
            <h3 style={{ margin: 0 }}>Export</h3>
            <button onClick={() => setIsExportOpen(true)} disabled={session === null}>
              Open Export Settings
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 11, alignContent: "start", alignItems: "start" }}>
          <VideoCanvas
            frameUrl={frameUrl}
            width={session?.width ?? 640}
            height={session?.height ?? 360}
            objects={currentFrameObjects}
            objectColors={objectColors}
            visibilityByObjectId={objectVisibility}
            selectedObjId={selectedObjId}
            clickMode={clickMode}
            lastClick={currentFrameLastClick}
            onPointPrompt={(point) => void handlePointPrompt(point)}
          />

          <PlaybackControls
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((prev) => !prev)}
            onStepBackward={() => setCurrentFrame((prev) => Math.max(0, prev - 1))}
            onStepForward={() => {
              if (session === null) return;
              setCurrentFrame((prev) => Math.min(session.processing_num_frames - 1, prev + 1));
            }}
            processingFps={session?.processing_fps ?? 0}
            currentFrame={currentFrame}
            totalFrames={session?.processing_num_frames ?? 1}
            onFrameChange={setCurrentFrame}
          />

          <ErrorPanel latestError={latestError} history={errorHistory} />
        </div>
      </div>

      {isExportOpen ? (
        <div
          onClick={() => setIsExportOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "grid",
            placeItems: "center",
            padding: 17,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(760px, 100%)",
              maxHeight: "90vh",
              overflow: "auto",
              background: "#f8fafc",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: 11,
              display: "grid",
              gap: 9,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Export</h3>
              <button onClick={() => setIsExportOpen(false)}>Close</button>
            </div>

            <ExportPanel
              disabled={session === null}
              isExporting={isExporting}
              formats={exportFormats}
              mergeMode={mergeMode}
              mergeGroupsText={mergeGroupsText}
              frameStart={exportFrameStart}
              frameEnd={exportFrameEnd}
              includeImages={exportIncludeImages}
              autoPropagate={autoPropagateForExport}
              onFormatChange={(format, checked) => {
                setExportFormats((prev) => ({ ...prev, [format]: checked }));
              }}
              onMergeModeChange={setMergeMode}
              onMergeGroupsTextChange={setMergeGroupsText}
              onFrameStartChange={setExportFrameStart}
              onFrameEndChange={setExportFrameEnd}
              onIncludeImagesChange={setExportIncludeImages}
              onAutoPropagateChange={setAutoPropagateForExport}
              onDownload={() => void handleDownloadExport()}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

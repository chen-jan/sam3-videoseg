"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  addClickPrompt,
  addTextPrompt,
  buildFrameUrl,
  createObject,
  deleteStoredVideos,
  deleteSession,
  exportSession,
  getStorageStatus,
  listStoredVideos,
  loadStoredVideo,
  openPropagationSocket,
  renameStoredVideo,
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
  StorageStatusResponse,
  StoredVideoInfo,
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
import { StoragePanel } from "../components/StoragePanel";

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
  type UploadFpsMode = "auto" | "custom";

  const [session, setSession] = useState<UploadResponse | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [maskCache, setMaskCache] = useState<Record<number, ObjectOutput[]>>({});
  const [objectsById, setObjectsById] = useState<Record<number, TrackedObject>>({});
  const [selectedObjId, setSelectedObjId] = useState<number | null>(null);
  const [clickMode, setClickMode] = useState<ClickMode>("positive");
  const [textPrompt, setTextPrompt] = useState("person");
  const [isPropagating, setIsPropagating] = useState(false);
  const [propagationProgress, setPropagationProgress] = useState<{
    completed: number;
    total: number;
    percent: number;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFrameLoading, setIsFrameLoading] = useState(false);
  const [frameLoadingLabel, setFrameLoadingLabel] = useState("Loading video...");
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [isUploadOptionsOpen, setIsUploadOptionsOpen] = useState(false);
  const [uploadFpsMode, setUploadFpsMode] = useState<UploadFpsMode>("auto");
  const [uploadCustomFps, setUploadCustomFps] = useState("15");
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
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  const [isStorageBusy, setIsStorageBusy] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatusResponse | null>(null);
  const [storedVideos, setStoredVideos] = useState<StoredVideoInfo[]>([]);
  const [selectedStoredVideoIds, setSelectedStoredVideoIds] = useState<string[]>([]);
  const [activeStoredVideoId, setActiveStoredVideoId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const promptMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const propagationSeenFramesRef = useRef<Set<number>>(new Set());

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

  const enqueuePromptMutation = async <T,>(operation: () => Promise<T>): Promise<T> => {
    const next = promptMutationQueueRef.current.catch(() => undefined).then(operation);
    promptMutationQueueRef.current = next.then(
      () => undefined,
      () => undefined
    );
    return next;
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

  const applyLoadedSession = (uploaded: UploadResponse) => {
    setSession(uploaded);
    setCurrentFrame(0);
    setMaskCache({});
    setObjectsById({});
    setSelectedObjId(null);
    setIsPropagating(false);
    setPropagationProgress(null);
    propagationSeenFramesRef.current.clear();
    setIsPlaying(false);
    setLastClick(null);
    setStatus(
      `Ready: ${uploaded.processing_num_frames} frames @ ${uploaded.processing_fps.toFixed(2)} fps`
    );
  };

  const refreshStorage = async () => {
    try {
      setIsStorageBusy(true);
      const [nextStatus, videos] = await Promise.all([getStorageStatus(), listStoredVideos()]);
      setStorageStatus(nextStatus);
      setStoredVideos(videos);
      setSelectedStoredVideoIds((prev) =>
        prev.filter((videoId) => videos.some((video) => video.video_id === videoId))
      );
    } catch (error) {
      pushError(error, "storage_refresh");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Storage refresh failed: ${message}`);
    } finally {
      setIsStorageBusy(false);
    }
  };

  const handleUpload = async (file: File, requestedProcessingFps?: number) => {
    try {
      setFrameLoadingLabel("Loading uploaded video...");
      setIsFrameLoading(true);
      setStatus("Uploading and preprocessing video...");
      closePropagationSocket();
      if (session !== null) {
        await deleteSession(session.session_id);
      }
      const uploaded = await uploadVideo(file, {
        processingFps: requestedProcessingFps ?? null,
      });
      setActiveStoredVideoId(null);
      applyLoadedSession(uploaded);
      if (isStorageOpen) {
        await refreshStorage();
      }
    } catch (error) {
      setIsFrameLoading(false);
      pushError(error, "upload");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Upload failed: ${message}`);
    }
  };

  const handleConfirmUploadOptions = async () => {
    if (pendingUploadFile === null) {
      return;
    }

    let requestedFps: number | undefined;
    if (uploadFpsMode === "custom") {
      const parsed = Number(uploadCustomFps);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setStatus("Custom upload FPS must be a number greater than 0.");
        return;
      }
      requestedFps = parsed;
    }

    const file = pendingUploadFile;
    setPendingUploadFile(null);
    setIsUploadOptionsOpen(false);
    await handleUpload(file, requestedFps);
  };

  const handleSubmitTextPrompt = async () => {
    if (session === null) {
      return;
    }
    try {
      setStatus("Running text prompt...");
      const response = await enqueuePromptMutation(() =>
        addTextPrompt(session.session_id, {
          frame_index: currentFrame,
          text: textPrompt,
          reset_first: false,
        })
      );
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
      const response = await enqueuePromptMutation(() =>
        addClickPrompt(session.session_id, {
          frame_index: currentFrame,
          obj_id: selectedObjId,
          points: [point],
        })
      );
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
      setPropagationProgress(null);
      propagationSeenFramesRef.current.clear();
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
    propagationSeenFramesRef.current = new Set();
    setPropagationProgress({
      completed: 0,
      total: session.processing_num_frames,
      percent: 0,
    });
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
          propagationSeenFramesRef.current.add(event.frame_index);
          const completed = propagationSeenFramesRef.current.size;
          const total = session.processing_num_frames;
          const percent = total > 0 ? (completed / total) * 100 : 0;
          setPropagationProgress({ completed, total, percent });
          setStatus(
            `Propagating... frame ${event.frame_index + 1}/${session.processing_num_frames}`
          );
        },
        onDone: () => {
          setIsPropagating(false);
          const total = session.processing_num_frames;
          setPropagationProgress({ completed: total, total, percent: 100 });
          setStatus("Propagation complete.");
          closePropagationSocket();
        },
        onError: (event) => {
          setIsPropagating(false);
          setPropagationProgress(null);
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

  const handleOpenStorage = async () => {
    setIsStorageOpen(true);
    await refreshStorage();
  };

  const handleLoadStoredVideo = async (videoId: string) => {
    try {
      setIsStorageOpen(false);
      setFrameLoadingLabel("Loading stored video...");
      setIsFrameLoading(true);
      setStatus("Loading video from server storage...");
      closePropagationSocket();
      if (session !== null) {
        await deleteSession(session.session_id);
      }
      const uploaded = await loadStoredVideo(videoId);
      setActiveStoredVideoId(videoId);
      applyLoadedSession(uploaded);
      await refreshStorage();
    } catch (error) {
      setIsFrameLoading(false);
      pushError(error, "storage_load");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Stored video load failed: ${message}`);
    }
  };

  const handleRenameStoredVideo = async (videoId: string, displayName: string) => {
    try {
      setIsStorageBusy(true);
      await renameStoredVideo(videoId, displayName);
      setStatus("Stored video renamed.");
      await refreshStorage();
    } catch (error) {
      pushError(error, "storage_rename");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Rename failed: ${message}`);
      setIsStorageBusy(false);
    }
  };

  const handleDeleteSelectedStoredVideos = async () => {
    if (selectedStoredVideoIds.length === 0) {
      return;
    }
    try {
      setIsStorageBusy(true);
      const deleting = [...selectedStoredVideoIds];
      const response = await deleteStoredVideos(deleting);
      setSelectedStoredVideoIds([]);
      if (
        activeStoredVideoId !== null &&
        deleting.includes(activeStoredVideoId)
      ) {
        setActiveStoredVideoId(null);
      }
      setStatus(`Deleted ${response.deleted} stored video(s).`);
      await refreshStorage();
    } catch (error) {
      pushError(error, "storage_delete");
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Delete failed: ${message}`);
      setIsStorageBusy(false);
    }
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
    if (session === null) {
      setIsFrameLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (lastClick === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      setLastClick(null);
    }, 450);
    return () => {
      window.clearTimeout(timer);
    };
  }, [lastClick]);

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

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 11, display: "grid", gap: 9 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 500 }}>Upload Video (max 60s, capped to 900 frames)</span>
          <button onClick={() => void handleOpenStorage()} style={{ padding: "4px 10px", fontSize: 13 }}>
            Storage
          </button>
        </div>
        <label style={{ display: "grid", gap: 7 }}>
          <span style={{ color: "#666", fontSize: 13 }}>Choose a video file</span>
          <input
            type="file"
            accept="video/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setPendingUploadFile(file);
                setUploadFpsMode("auto");
                setIsUploadOptionsOpen(true);
              }
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {isUploadOptionsOpen ? (
        <div
          onClick={() => {
            setIsUploadOptionsOpen(false);
            setPendingUploadFile(null);
          }}
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
              width: "min(520px, 100%)",
              background: "#f8fafc",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: 12,
              display: "grid",
              gap: 10,
            }}
          >
            <h3 style={{ margin: 0 }}>Upload Settings</h3>
            <small style={{ color: "#666" }}>
              File: {pendingUploadFile?.name ?? "none"}
            </small>

            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  name="upload-fps-mode"
                  checked={uploadFpsMode === "auto"}
                  onChange={() => setUploadFpsMode("auto")}
                />
                <span>Auto FPS (recommended)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  name="upload-fps-mode"
                  checked={uploadFpsMode === "custom"}
                  onChange={() => setUploadFpsMode("custom")}
                />
                <span>Custom extraction FPS</span>
              </label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={uploadCustomFps}
                disabled={uploadFpsMode !== "custom"}
                onChange={(event) => setUploadCustomFps(event.target.value)}
                placeholder="e.g. 12"
              />
              <small style={{ color: "#666" }}>
                Final FPS is capped by source FPS and the 900-frame session limit.
              </small>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => {
                  setIsUploadOptionsOpen(false);
                  setPendingUploadFile(null);
                }}
              >
                Cancel
              </button>
              <button onClick={() => void handleConfirmUploadOptions()}>Start Upload</button>
            </div>
          </div>
        </div>
      ) : null}

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
            propagationProgress={propagationProgress}
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
                [objId]: { ...prev[objId], className, instanceName: className },
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
            showLoadingOverlay={isFrameLoading}
            loadingLabel={frameLoadingLabel}
            onFrameRendered={() => setIsFrameLoading(false)}
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

      <StoragePanel
        isOpen={isStorageOpen}
        isBusy={isStorageBusy}
        status={storageStatus}
        videos={storedVideos}
        selectedVideoIds={selectedStoredVideoIds}
        activeVideoId={activeStoredVideoId}
        onClose={() => setIsStorageOpen(false)}
        onRefresh={() => void refreshStorage()}
        onToggleSelect={(videoId) => {
          setSelectedStoredVideoIds((prev) =>
            prev.includes(videoId)
              ? prev.filter((id) => id !== videoId)
              : [...prev, videoId]
          );
        }}
        onSelectAll={(checked) => {
          if (checked) {
            setSelectedStoredVideoIds(storedVideos.map((video) => video.video_id));
          } else {
            setSelectedStoredVideoIds([]);
          }
        }}
        onLoad={(videoId) => void handleLoadStoredVideo(videoId)}
        onRename={(videoId, displayName) => void handleRenameStoredVideo(videoId, displayName)}
        onDeleteSelected={() => void handleDeleteSelectedStoredVideos()}
      />

    </main>
  );
}

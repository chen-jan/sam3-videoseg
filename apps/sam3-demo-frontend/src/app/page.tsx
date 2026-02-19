"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  addClickPrompt,
  addTextPrompt,
  buildFrameUrl,
  createObject,
  deleteSession,
  openPropagationSocket,
  removeObject,
  resetSession,
  uploadVideo,
} from "../lib/api";
import {
  ClickMode,
  ObjectOutput,
  PointInput,
  PromptResponse,
  TrackedObject,
  UploadResponse,
} from "../lib/types";
import { FrameScrubber } from "../components/FrameScrubber";
import { ObjectList } from "../components/ObjectList";
import { PlaybackControls } from "../components/PlaybackControls";
import { PromptPanel } from "../components/PromptPanel";
import { VideoCanvas } from "../components/VideoCanvas";

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
          next[output.obj_id] = {
            objId: output.obj_id,
            color: colorForObjId(output.obj_id),
            visible: true,
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
      setStatus(
        `Ready: ${uploaded.processing_num_frames} frames @ ${uploaded.processing_fps.toFixed(2)} fps`
      );
    } catch (error) {
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
      };
      setObjectsById((prev) => ({ ...prev, [object.objId]: object }));
      setSelectedObjId(object.objId);
      setStatus(
        `Added manual object ${Math.abs(object.objId)} (id ${object.objId}). ` +
          `Now click on the image: left=positive, right=negative.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to add object: ${message}`);
    }
  };

  const handlePointPrompt = async (point: PointInput) => {
    if (session === null || selectedObjId === null) {
      setStatus("Select or create an object first.");
      return;
    }
    try {
      const response = await addClickPrompt(session.session_id, {
        frame_index: currentFrame,
        obj_id: selectedObjId,
        points: [point],
      });
      applyPromptResponse(response);
      setStatus(`Applied ${point.label === 1 ? "positive" : "negative"} click.`);
    } catch (error) {
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
      setStatus("Session reset.");
    } catch (error) {
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
    setStatus("Propagation started...");

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
          const message =
            event instanceof Error ? event.message : `${event.code}: ${event.message}`;
          setStatus(`Propagation error: ${message}`);
          closePropagationSocket();
        },
      }
    );
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
    <main style={{ padding: 20, display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>SAM3 Single-User Demo</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <label style={{ display: "grid", gap: 8 }}>
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
          gap: 16,
        }}
      >
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
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
            onRemove={(objId) => void handleRemoveObject(objId)}
          />
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <VideoCanvas
            frameUrl={frameUrl}
            width={session?.width ?? 640}
            height={session?.height ?? 360}
            objects={currentFrameObjects}
            objectColors={objectColors}
            visibilityByObjectId={objectVisibility}
            selectedObjId={selectedObjId}
            clickMode={clickMode}
            onPointPrompt={(point) => void handlePointPrompt(point)}
          />

          <PlaybackControls
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((prev) => !prev)}
            onStepBackward={() => setCurrentFrame((prev) => Math.max(0, prev - 1))}
            onStepForward={() => {
              if (session === null) return;
              setCurrentFrame((prev) =>
                Math.min(session.processing_num_frames - 1, prev + 1)
              );
            }}
            processingFps={session?.processing_fps ?? 0}
          />

          <FrameScrubber
            currentFrame={currentFrame}
            totalFrames={session?.processing_num_frames ?? 1}
            onChange={setCurrentFrame}
          />
        </div>
      </div>
    </main>
  );
}

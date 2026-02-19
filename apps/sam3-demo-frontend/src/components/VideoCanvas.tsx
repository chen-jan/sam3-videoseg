import { MouseEvent, useEffect, useRef } from "react";

import { ObjectOutput, PointInput } from "../lib/types";

interface LastClickMarker {
  x: number;
  y: number;
  label: 0 | 1;
  objId: number;
}

interface VideoCanvasProps {
  frameUrl: string | null;
  width: number;
  height: number;
  objects: ObjectOutput[];
  objectColors: Record<number, string>;
  visibilityByObjectId: Record<number, boolean>;
  selectedObjId: number | null;
  clickMode: "positive" | "negative";
  lastClick: LastClickMarker | null;
  onPointPrompt: (point: PointInput) => void;
}

const decodedMaskCache = new Map<string, Uint8Array>();

function hexToRgb(color: string): [number, number, number] {
  const normalized = color.trim();
  const fallback: [number, number, number] = [30, 144, 255];
  if (!normalized.startsWith("#") || normalized.length !== 7) {
    return fallback;
  }
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return fallback;
  }
  return [r, g, b];
}

function decodeCompressedCounts(counts: string): number[] {
  const runs: number[] = [];
  let index = 0;
  while (index < counts.length) {
    let value = 0;
    let shift = 0;
    let chunk = 0;

    do {
      chunk = counts.charCodeAt(index) - 48;
      value |= (chunk & 0x1f) << (5 * shift);
      shift += 1;
      index += 1;
    } while (chunk & 0x20);

    if (chunk & 0x10) {
      value |= -1 << (5 * shift);
    }
    if (runs.length > 2) {
      value += runs[runs.length - 2];
    }
    runs.push(value);
  }
  return runs;
}

function decodeMask(size: [number, number] | number[], counts: string): Uint8Array {
  const cacheKey = `${size[0]}x${size[1]}:${counts}`;
  const cached = decodedMaskCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const [height, width] = size;
  const total = height * width;
  const runs = decodeCompressedCounts(counts);

  const fortranMask = new Uint8Array(total);
  let cursor = 0;
  let value = 0;
  for (const run of runs) {
    const end = Math.min(cursor + run, total);
    if (value === 1) {
      fortranMask.fill(1, cursor, end);
    }
    cursor = end;
    value = value === 1 ? 0 : 1;
    if (cursor >= total) {
      break;
    }
  }

  const rowMajorMask = new Uint8Array(total);
  for (let col = 0; col < width; col += 1) {
    for (let row = 0; row < height; row += 1) {
      const fIndex = col * height + row;
      const rIndex = row * width + col;
      rowMajorMask[rIndex] = fortranMask[fIndex];
    }
  }

  decodedMaskCache.set(cacheKey, rowMajorMask);
  return rowMajorMask;
}

function getRenderedContentRect(
  displayWidth: number,
  displayHeight: number,
  contentWidth: number,
  contentHeight: number
) {
  if (displayWidth <= 0 || displayHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
    return null;
  }
  const scale = Math.min(displayWidth / contentWidth, displayHeight / contentHeight);
  const renderedWidth = contentWidth * scale;
  const renderedHeight = contentHeight * scale;
  const offsetX = (displayWidth - renderedWidth) / 2;
  const offsetY = (displayHeight - renderedHeight) / 2;
  return { offsetX, offsetY, renderedWidth, renderedHeight };
}

export function VideoCanvas({
  frameUrl,
  width,
  height,
  objects,
  objectColors,
  visibilityByObjectId,
  selectedObjId,
  clickMode,
  lastClick,
  onPointPrompt,
}: VideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    if (!frameUrl) {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const drawWidth = image.naturalWidth > 0 ? image.naturalWidth : width;
      const drawHeight = image.naturalHeight > 0 ? image.naturalHeight : height;
      canvas.width = drawWidth;
      canvas.height = drawHeight;
      context.clearRect(0, 0, drawWidth, drawHeight);
      context.drawImage(image, 0, 0, drawWidth, drawHeight);

      if (objects.length > 0) {
        let base: ImageData;
        try {
          base = context.getImageData(0, 0, drawWidth, drawHeight);
        } catch (error) {
          console.error("Unable to read canvas pixels for mask overlay.", error);
          return;
        }

        const data = base.data;
        const alpha = 0.42;

        for (const object of objects) {
          const visible = visibilityByObjectId[object.obj_id] ?? true;
          if (!visible) {
            continue;
          }
          const [maskHeight, maskWidth] = object.mask_rle.size;
          const mask = decodeMask(object.mask_rle.size, object.mask_rle.counts);
          const [r, g, b] = hexToRgb(objectColors[object.obj_id] ?? "#1e90ff");

          if (maskWidth === drawWidth && maskHeight === drawHeight) {
            for (let i = 0; i < mask.length; i += 1) {
              if (mask[i] === 0) {
                continue;
              }
              const offset = i * 4;
              data[offset] = Math.round(data[offset] * (1 - alpha) + r * alpha);
              data[offset + 1] = Math.round(data[offset + 1] * (1 - alpha) + g * alpha);
              data[offset + 2] = Math.round(data[offset + 2] * (1 - alpha) + b * alpha);
            }
            continue;
          }

          const xScale = maskWidth / drawWidth;
          const yScale = maskHeight / drawHeight;
          for (let y = 0; y < drawHeight; y += 1) {
            const srcY = Math.min(maskHeight - 1, Math.floor((y + 0.5) * yScale));
            const dstRow = y * drawWidth;
            const srcRow = srcY * maskWidth;
            for (let x = 0; x < drawWidth; x += 1) {
              const srcX = Math.min(maskWidth - 1, Math.floor((x + 0.5) * xScale));
              if (mask[srcRow + srcX] === 0) {
                continue;
              }
              const offset = (dstRow + x) * 4;
              data[offset] = Math.round(data[offset] * (1 - alpha) + r * alpha);
              data[offset + 1] = Math.round(data[offset + 1] * (1 - alpha) + g * alpha);
              data[offset + 2] = Math.round(data[offset + 2] * (1 - alpha) + b * alpha);
            }
          }
        }

        context.putImageData(base, 0, 0);
      }

      if (lastClick !== null) {
        const px = Math.max(0, Math.min(drawWidth - 1, Math.round(lastClick.x * drawWidth)));
        const py = Math.max(0, Math.min(drawHeight - 1, Math.round(lastClick.y * drawHeight)));
        context.strokeStyle = lastClick.label === 1 ? "#22c55e" : "#ef4444";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(px, py, 7, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(px - 10, py);
        context.lineTo(px + 10, py);
        context.moveTo(px, py - 10);
        context.lineTo(px, py + 10);
        context.stroke();
      }

      if (selectedObjId !== null) {
        context.fillStyle = "rgba(0,0,0,0.55)";
        context.fillRect(8, 8, 170, 24);
        context.fillStyle = "#fff";
        context.font = "14px monospace";
        context.fillText(`Selected obj: ${selectedObjId}`, 14, 25);
      }
    };
    image.src = frameUrl;
  }, [
    frameUrl,
    width,
    height,
    objects,
    objectColors,
    visibilityByObjectId,
    lastClick,
    selectedObjId,
  ]);

  const emitPoint = (event: MouseEvent<HTMLCanvasElement>, label: 0 | 1) => {
    if (selectedObjId === null) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const rendered = getRenderedContentRect(rect.width, rect.height, canvas.width, canvas.height);
    if (!rendered) {
      return;
    }

    const localX = event.clientX - rect.left - rendered.offsetX;
    const localY = event.clientY - rect.top - rendered.offsetY;
    if (
      localX < 0 ||
      localY < 0 ||
      localX > rendered.renderedWidth ||
      localY > rendered.renderedHeight
    ) {
      return;
    }

    const x = localX / rendered.renderedWidth;
    const y = localY / rendered.renderedHeight;
    onPointPrompt({ x, y, label });
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={(event) => {
        const label = clickMode === "positive" ? 1 : 0;
        emitPoint(event, label);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        emitPoint(event, 0);
      }}
      style={{
        width: "100%",
        maxHeight: "72vh",
        display: "block",
        objectFit: "contain",
        border: "1px solid #ddd",
        borderRadius: 8,
        cursor: selectedObjId === null ? "not-allowed" : "crosshair",
      }}
    />
  );
}

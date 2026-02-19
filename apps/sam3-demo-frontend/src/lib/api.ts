import {
  ClickPromptRequest,
  CreateObjectResponse,
  ExportRequest,
  OperationResponse,
  PromptResponse,
  PropagationFrameEvent,
  PropagationStart,
  TextPromptRequest,
  UploadResponse,
  WsErrorPayload,
} from "./types";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000").replace(
  /\/$/,
  ""
);

interface ApiErrorDetail {
  code: string;
  message: string;
  details?: string;
  request_id?: string;
}

export class ApiError extends Error {
  code: string;
  details?: string;
  requestId?: string;
  status: number;

  constructor(status: number, detail: ApiErrorDetail) {
    super(detail.message || "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.code = detail.code || "UNKNOWN_ERROR";
    this.details = detail.details;
    this.requestId = detail.request_id;
  }
}

function toApiError(status: number, payload: unknown): ApiError {
  const fallback: ApiErrorDetail = {
    code: "BAD_RESPONSE",
    message: "Unexpected server response",
  };
  if (typeof payload === "object" && payload !== null) {
    const p = payload as { detail?: unknown; code?: unknown; message?: unknown };
    if (typeof p.detail === "object" && p.detail !== null) {
      const d = p.detail as Record<string, unknown>;
      return new ApiError(status, {
        code: typeof d.code === "string" ? d.code : fallback.code,
        message: typeof d.message === "string" ? d.message : fallback.message,
        details: typeof d.details === "string" ? d.details : undefined,
        request_id: typeof d.request_id === "string" ? d.request_id : undefined,
      });
    }
    return new ApiError(status, {
      code: typeof p.code === "string" ? p.code : fallback.code,
      message: typeof p.message === "string" ? p.message : fallback.message,
    });
  }
  return new ApiError(status, fallback);
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { detail: { code: "BAD_RESPONSE", message: text } };
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await parseJson(response);
  if (!response.ok) {
    throw toApiError(response.status, payload);
  }
  return payload as T;
}

export function buildFrameUrl(sessionId: string, frameIndex: number): string {
  return `${BACKEND_URL}/api/sessions/${sessionId}/frames/${frameIndex}.jpg`;
}

export async function uploadVideo(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return requestJson<UploadResponse>(`${BACKEND_URL}/api/videos/upload`, {
    method: "POST",
    body: form,
  });
}

export async function addTextPrompt(
  sessionId: string,
  req: TextPromptRequest
): Promise<PromptResponse> {
  return requestJson<PromptResponse>(`${BACKEND_URL}/api/sessions/${sessionId}/prompt/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function createObject(sessionId: string): Promise<CreateObjectResponse> {
  return requestJson<CreateObjectResponse>(`${BACKEND_URL}/api/sessions/${sessionId}/objects`, {
    method: "POST",
  });
}

export async function addClickPrompt(
  sessionId: string,
  req: ClickPromptRequest
): Promise<PromptResponse> {
  return requestJson<PromptResponse>(`${BACKEND_URL}/api/sessions/${sessionId}/prompt/clicks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function removeObject(sessionId: string, objId: number): Promise<OperationResponse> {
  return requestJson<OperationResponse>(
    `${BACKEND_URL}/api/sessions/${sessionId}/objects/${objId}/remove`,
    {
      method: "POST",
    }
  );
}

export async function resetSession(sessionId: string): Promise<OperationResponse> {
  return requestJson<OperationResponse>(`${BACKEND_URL}/api/sessions/${sessionId}/reset`, {
    method: "POST",
  });
}

export async function deleteSession(sessionId: string): Promise<OperationResponse> {
  return requestJson<OperationResponse>(`${BACKEND_URL}/api/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function exportSession(
  sessionId: string,
  req: ExportRequest
): Promise<Blob> {
  const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    throw toApiError(response.status, await parseJson(response));
  }
  return response.blob();
}

function wsUrlForSession(sessionId: string): string {
  const url = new URL(`${BACKEND_URL}/api/sessions/${sessionId}/propagate`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function openPropagationSocket(
  sessionId: string,
  start: PropagationStart,
  handlers: {
    onFrame: (event: PropagationFrameEvent) => void;
    onDone: () => void;
    onError: (error: WsErrorPayload | Error) => void;
  }
): WebSocket {
  const ws = new WebSocket(wsUrlForSession(sessionId));

  ws.onopen = () => {
    ws.send(JSON.stringify({ action: "start", ...start }));
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as unknown;
      if (typeof payload !== "object" || payload === null) {
        return;
      }
      const msg = payload as Record<string, unknown>;
      if (msg.type === "propagation_frame") {
        handlers.onFrame(msg as unknown as PropagationFrameEvent);
        return;
      }
      if (msg.type === "propagation_done") {
        handlers.onDone();
        return;
      }
      if (msg.type === "error") {
        handlers.onError({
          type: "error",
          code: typeof msg.code === "string" ? msg.code : "WS_ERROR",
          message: typeof msg.message === "string" ? msg.message : "Propagation error",
          details: typeof msg.details === "string" ? msg.details : undefined,
          request_id: typeof msg.request_id === "string" ? msg.request_id : undefined,
        });
      }
    } catch (err) {
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  ws.onerror = () => {
    handlers.onError(new Error("WebSocket connection failed"));
  };

  ws.onclose = (event) => {
    if (!event.wasClean) {
      handlers.onError({
        code: "WS_CLOSED",
        message: `WebSocket closed unexpectedly (${event.code})`,
      });
    }
  };

  return ws;
}

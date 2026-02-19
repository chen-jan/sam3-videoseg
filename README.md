# SAM3 Demo Workspace

A monorepo wrapping Meta's **Segment Anything Model 3 (SAM3)** with an interactive web-based demo for real-time video segmentation. Upload a video, describe or click the objects you want to track, and watch SAM3 propagate masks across every frame.

---

## Table of Contents

- [Repository Layout](#repository-layout)
- [Architecture Overview](#architecture-overview)
- [How It Works: End-to-End Data Flow](#how-it-works-end-to-end-data-flow)
- [Backend (FastAPI)](#backend-fastapi)
- [Frontend (Next.js)](#frontend-nextjs)
- [Upstream SAM3 Model](#upstream-sam3-model)
- [API Reference](#api-reference)
- [Quick Start](#quick-start)
- [Remote GPU Setup (Lambda Labs)](#remote-gpu-setup-lambda-labs)
- [Configuration](#configuration)
- [Current Limitations](#current-limitations)
- [Production Roadmap](#production-roadmap)

---

## Repository Layout

```
sam3-videoseg/
├── apps/
│   ├── sam3-demo-backend/       # FastAPI backend — video processing, SAM3 inference, mask streaming
│   │   ├── app/
│   │   │   ├── main.py          # HTTP + WebSocket endpoints
│   │   │   ├── sam3_service.py  # Wrapper bridging API requests to SAM3 predictor
│   │   │   ├── session_store.py # In-memory single-session state with thread-safe locking
│   │   │   ├── video_io.py      # FFmpeg/FFprobe: upload, probe, frame extraction
│   │   │   ├── mask_codec.py    # COCO RLE encoding/decoding of binary masks
│   │   │   ├── export_utils.py  # Export ZIP builder (COCO, YOLO-seg, binary PNG masks)
│   │   │   ├── storage_library.py # Stored upload catalog (list/load/rename/delete)
│   │   │   ├── models.py        # Pydantic request/response schemas
│   │   │   ├── config.py        # Environment-based settings
│   │   │   └── errors.py        # Structured error codes
│   │   ├── tests/               # pytest tests (service, export, storage, mask codec, video policies)
│   │   └── pyproject.toml
│   │
│   └── sam3-demo-frontend/      # Next.js 15 frontend — interactive canvas UI
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx     # Main page: upload, state management, orchestration
│       │   │   ├── layout.tsx   # Root layout
│       │   │   └── globals.css
│       │   ├── components/
│       │   │   ├── VideoCanvas.tsx      # Canvas rendering of frames + mask overlays
│       │   │   ├── PromptPanel.tsx      # Text input, click mode, propagation controls
│       │   │   ├── ObjectList.tsx       # Object list with visibility/selection/removal
│       │   │   ├── ExportPanel.tsx      # Export format, merge, and scope controls
│       │   │   ├── StoragePanel.tsx     # Stored video browser and management UI
│       │   │   ├── ErrorPanel.tsx       # API/WS error details and history
│       │   │   ├── PlaybackControls.tsx # Play/pause and frame stepping
│       │   │   └── FrameScrubber.tsx    # (legacy) standalone slider component
│       │   └── lib/
│       │       ├── api.ts       # HTTP + WebSocket client functions
│       │       └── types.ts     # TypeScript interfaces matching backend schemas
│       ├── package.json
│       └── tsconfig.json
│
├── docs/
│   ├── demo-setup.md            # Detailed setup and deployment instructions
│   └── production-architecture.md  # Multi-user production scaling blueprint
│
└── upstream/sam3-original/      # Untouched upstream SAM3 codebase
    ├── sam3/                    # Model code, training, evaluation, agent
    ├── examples/                # Jupyter notebooks (image, video, agent tasks)
    ├── pyproject.toml
    ├── README.md                # Original SAM3 README
    └── LICENSE
```

The upstream SAM3 code is kept as-is in `upstream/sam3-original/`. The demo app lives entirely under `apps/` and imports SAM3 as an installed package.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        User's Browser                            │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ PromptPanel  │  │  ObjectList  │  │     VideoCanvas        │ │
│  │ (text/click) │  │ (track list) │  │ (frame + mask overlay) │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────┘ │
│         │                 │                        │             │
│  ┌──────┴─────────────────┴────────────────────────┘             │
│  │  page.tsx — state manager (React hooks)                       │
│  │  ┌─────────┐  ┌───────────┐  ┌────────────────┐              │
│  │  │maskCache│  │objectsById│  │ currentFrame   │              │
│  │  └─────────┘  └───────────┘  └────────────────┘              │
│  └──────────────────────┬────────────────────────────────────────┘
│                         │ HTTP + WebSocket
└─────────────────────────┼────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│                    FastAPI Backend                                │
│                                                                  │
│  main.py ──► Routing + validation                                │
│      │                                                           │
│      ├──► video_io.py ──► FFmpeg (frame extraction, metadata)    │
│      │                                                           │
│      ├──► sam3_service.py ──► SAM3 Predictor                     │
│      │        │                    │                             │
│      │        │              ┌─────▼──────┐                      │
│      │        │              │ SAM3 Model │                      │
│      │        │              │  (848M)    │                      │
│      │        │              │ GPU / CUDA │                      │
│      │        │              └────────────┘                      │
│      │        │                                                  │
│      │        └──► mask_codec.py ──► COCO RLE encode/decode      │
│      │                                                           │
│      ├──► session_store.py ──► In-memory session (1 at a time)   │
│      └──► storage_library.py ──► Stored upload catalog           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **Separation of concerns** — The upstream ML model is never modified. `sam3_service.py` is the sole bridge translating HTTP/WS requests into SAM3 predictor calls.
- **Single-session simplicity** — Only one active session exists at a time, stored in-memory. This avoids distributed state for the demo use case.
- **Streaming propagation** — Mask propagation uses a WebSocket that yields results frame-by-frame, so the UI updates in real time rather than waiting for the full video to process.
- **Generation tokens** — Each propagation gets a monotonic generation ID. If the user starts a new propagation, stale ones are detected and skipped.
- **Mixed-precision safety** — Predictor calls are wrapped in explicit CUDA bf16 autocast context in `sam3_service.py` to avoid intermittent dtype mismatches across request contexts.

---

## How It Works: End-to-End Data Flow

### 1. Video Upload

```
User selects video file
        │
        ▼
Frontend: uploadVideo() → POST /api/videos/upload (multipart)
        │
        ▼
Backend:
  ├─ Save file to disk
  ├─ FFprobe: extract metadata (duration, fps, resolution)
  ├─ Validate: duration ≤ 60s
  ├─ Compute processing_fps = min(source_fps, max_frames / duration)
  ├─ FFmpeg: extract frames at processing_fps → JPEG sequence
  ├─ Initialize SAM3 predictor session on extracted frames
  └─ Return: session_id, frame count, dimensions, fps info
```

The dynamic FPS calculation ensures the total frame count stays under the configurable cap (default 900), preventing memory issues on long or high-fps videos.

### 2. Interactive Prompting

**Text prompts** — Type a description like "dog" or "person in red shirt". SAM3's text encoder finds matching objects on the current frame.

**Click prompts** — Click directly on the canvas. Left-click marks positive points (what to segment), right-click marks negative points (what to exclude). Multiple clicks refine the mask.

```
User enters "dog" on frame 0  (or clicks on an object)
        │
        ▼
Frontend → POST /api/sessions/{id}/prompt/text (or /prompt/clicks)
        │
        ▼
Backend:
  ├─ sam3_service translates to SAM3 predictor request
  ├─ SAM3 runs inference: vision encoder → detector → masks + scores
  ├─ mask_codec encodes binary masks as COCO RLE
  └─ Return: PromptResponse { frame_index, objects[] { obj_id, mask_rle, score, bbox_xywh } }
        │
        ▼
Frontend:
  ├─ Stores masks in maskCache[frame_index]
  ├─ Registers new tracked objects in objectsById
  └─ Renders colored semi-transparent mask overlay on canvas
```

### 3. Mask Propagation

Once objects are prompted on one (or more) frames, propagation extends those masks across the entire video.

```
User clicks "Run Propagation"
        │
        ▼
Frontend: openPropagationSocket() → WS /api/sessions/{id}/propagate
        │
        ▼
Backend:
  ├─ Bumps generation token (cancels any stale propagation)
  ├─ Calls SAM3 tracker: propagate_in_video (forward / backward / both)
  └─ For each frame:
       ├─ Encode masks → COCO RLE
       ├─ Send WebSocket message: { type: "propagation_frame", frame_index, objects[] }
       └─ Check generation ID (stop if superseded)
        │
        ▼
Frontend receives each frame:
  ├─ Updates maskCache[frame_index]
  ├─ Updates progress status bar
  └─ Refreshes canvas if that frame is currently displayed
        │
        ▼
Final message: { type: "propagation_done" }
```

### 4. Playback and Review

After propagation completes, users can scrub the timeline or play through the video. Each frame's masks are already cached — the canvas reads from `maskCache[currentFrame]` and renders overlays instantly with no additional inference needed.

### 5. Stored Video Library

Uploaded videos are registered in a local manifest (`tmp/sam3-demo/uploads/library.json`) and can be listed, reloaded, renamed, and deleted via `/api/storage/*` endpoints.

### 6. Export

The export pipeline builds a ZIP from cached masks with optional auto-propagation for missing frames. Supported formats:
- COCO instance JSON
- YOLO segmentation (`classes.txt` + per-frame polygon labels)
- Per-object binary mask PNGs

Object metadata is controlled by:
- `class_name`: drives class/category assignment in COCO + YOLO
- `instance_name`: stored on COCO annotations for per-object identity

---

## Backend (FastAPI)

### Module Breakdown

| Module | Responsibility |
|--------|----------------|
| [main.py](apps/sam3-demo-backend/app/main.py) | All HTTP/WS endpoints, request validation, session lifecycle |
| [sam3_service.py](apps/sam3-demo-backend/app/sam3_service.py) | Loads SAM3 predictor, translates API calls to model requests |
| [session_store.py](apps/sam3-demo-backend/app/session_store.py) | Thread-safe single-session store with generation tracking |
| [video_io.py](apps/sam3-demo-backend/app/video_io.py) | FFmpeg/FFprobe wrapper: save, probe, extract, count frames |
| [mask_codec.py](apps/sam3-demo-backend/app/mask_codec.py) | Encode numpy masks to COCO RLE, decode back |
| [export_utils.py](apps/sam3-demo-backend/app/export_utils.py) | Builds export artifacts and ZIP layout |
| [storage_library.py](apps/sam3-demo-backend/app/storage_library.py) | Manages stored uploads and `library.json` manifest |
| [models.py](apps/sam3-demo-backend/app/models.py) | Pydantic v2 schemas for all request/response payloads |
| [config.py](apps/sam3-demo-backend/app/config.py) | `Settings` class reading from environment variables |
| [errors.py](apps/sam3-demo-backend/app/errors.py) | Typed error codes (`SESSION_NOT_FOUND`, `VIDEO_TOO_LONG`, etc.) |

### Session Lifecycle

1. **Upload or Load** creates a new active session (auto-cleans any previous one).
2. **Prompt** (text or clicks) adds/updates objects in SAM3 state.
3. **Propagate** streams masks for tracked objects across frames.
4. **Export** packages current annotations/masks as a ZIP.
5. **Reset** clears masks/objects but keeps the video loaded.
6. **Delete Session** closes active SAM3 state and clears extracted frames.
7. **Manage Stored Videos** list/load/rename/delete uploaded source videos.

---

## Frontend (Next.js)

### Component Breakdown

| Component | Responsibility |
|-----------|----------------|
| [page.tsx](apps/sam3-demo-frontend/src/app/page.tsx) | Root state manager — session, frames, masks, objects, playback |
| [VideoCanvas.tsx](apps/sam3-demo-frontend/src/components/VideoCanvas.tsx) | Renders video frame on `<canvas>` with colored mask overlays |
| [PromptPanel.tsx](apps/sam3-demo-frontend/src/components/PromptPanel.tsx) | Text input, click mode toggle, propagation/reset buttons |
| [ObjectList.tsx](apps/sam3-demo-frontend/src/components/ObjectList.tsx) | Lists tracked objects; select/visibility/remove + class/instance rename |
| [ExportPanel.tsx](apps/sam3-demo-frontend/src/components/ExportPanel.tsx) | Export format + merge + frame range controls |
| [StoragePanel.tsx](apps/sam3-demo-frontend/src/components/StoragePanel.tsx) | Server-side upload library manager |
| [ErrorPanel.tsx](apps/sam3-demo-frontend/src/components/ErrorPanel.tsx) | Error diagnostics with request IDs |
| [PlaybackControls.tsx](apps/sam3-demo-frontend/src/components/PlaybackControls.tsx) | Play/pause, previous/next frame buttons |
| [FrameScrubber.tsx](apps/sam3-demo-frontend/src/components/FrameScrubber.tsx) | Legacy standalone scrubber component |

### State Management

All state lives in React hooks within `page.tsx`:

- **`session`** — Current `UploadResponse` (session ID, dimensions, frame count)
- **`maskCache`** — `Record<frame_index, ObjectOutput[]>` caching decoded masks per frame
- **`objectsById`** — `Record<obj_id, TrackedObject>` with color, visibility, `className`, and `instanceName`
- **`currentFrame`** — Which frame is displayed on the canvas
- **`selectedObjId`** — Which object receives click prompts
- **`clickMode`** — `"positive"` or `"negative"` for click label
- **Export state** — selected formats, merge mode/groups, scope range, include-images toggle
- **Storage state** — server storage status, stored video list, selected videos for batch delete

### Mask Rendering

Masks arrive as COCO RLE (run-length encoded, Fortran column-major order). The frontend:

1. Decompresses RLE counts into a binary array
2. Converts from column-major to row-major order
3. Paints each `1` pixel with the object's assigned color at ~40% opacity
4. Overlays on top of the JPEG video frame

A 12-color palette ensures visually distinct objects.

---

## Upstream SAM3 Model

SAM3 (Segment Anything Model 3) is Meta's unified foundation model for promptable segmentation. Key facts:

- **848M parameters** — ViT-based vision encoder (1024-dim, 32 layers) with RoPE attention
- **Multi-modal prompting** — Supports text descriptions, point clicks, bounding boxes, and masks
- **Open-vocabulary** — Can segment 270K+ unique concepts
- **Unified detector + tracker** — Shared vision encoder with decoupled heads for images and video
- **Presence token** — Discriminates between closely related prompts ("player in white" vs. "player in red")

The demo uses `build_sam3_video_predictor()` which provides:
- `handle_request()` — Single-frame inference (text or click prompts)
- `handle_stream_request()` — Multi-frame propagation (yields frame-by-frame results)

For the full model documentation, training instructions, and evaluation benchmarks, see [upstream/sam3-original/README.md](upstream/sam3-original/README.md).

---

## API Reference

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/storage/status` | Server disk usage + uploads usage summary |
| `GET` | `/api/storage/videos` | List stored uploaded videos |
| `POST` | `/api/storage/videos/{video_id}/load` | Load a stored video into the active session |
| `PATCH` | `/api/storage/videos/{video_id}` | Rename stored video display name |
| `POST` | `/api/storage/videos/delete` | Delete one or more stored videos |
| `POST` | `/api/videos/upload` | Upload video (multipart), returns session info |
| `GET` | `/api/sessions/{id}/frames/{index}.jpg` | Serve extracted frame as JPEG |
| `POST` | `/api/sessions/{id}/prompt/text` | Add text prompt on a frame |
| `POST` | `/api/sessions/{id}/prompt/clicks` | Add click prompt(s) for an object |
| `POST` | `/api/sessions/{id}/objects` | Create a new empty object (for click prompting) |
| `POST` | `/api/sessions/{id}/objects/{obj_id}/remove` | Remove a tracked object |
| `POST` | `/api/sessions/{id}/reset` | Clear all masks and objects |
| `POST` | `/api/sessions/{id}/exports` | Build/export annotation ZIP |
| `DELETE` | `/api/sessions/{id}` | Delete session and all artifacts |

### WebSocket

| Path | Description |
|------|-------------|
| `WS /api/sessions/{id}/propagate` | Stream mask propagation frame-by-frame |

**Propagation protocol:**

```jsonc
// Client sends:
{ "action": "start", "direction": "both", "start_frame_index": null }  // direction: "forward" | "backward" | "both"

// Server streams:
{ "type": "propagation_frame", "frame_index": 0, "objects": [...] }
{ "type": "propagation_frame", "frame_index": 1, "objects": [...] }
// ...
{ "type": "propagation_done" }
```

### Key Schemas

```typescript
// Upload response
{ session_id, num_frames, width, height, source_fps, processing_fps, source_duration_sec }

// Prompt response
{ frame_index, objects: [{ obj_id, score, bbox_xywh, mask_rle: { size, counts } }] }

// Click prompt request
{ frame_index, obj_id, points: [{ x, y, label }] }  // x,y normalized [0,1]; label: 1=pos, 0=neg

// Text prompt request
{ frame_index, text, reset_first }

// Export request
{
  formats: ["coco_instance", "yolo_segmentation", "binary_masks_png"],
  object_meta: [{ obj_id, class_name, instance_name }],
  merge: { mode: "none" | "group" | "destructive_export", groups: [{ name, obj_ids }] },
  scope: { frame_start, frame_end, include_images },
  auto_propagate_if_incomplete
}
```

---

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 20+
- `ffmpeg` and `ffprobe` in your `PATH`
- CUDA GPU for real inference (CPU will be very slow)

### Install and Run

**Backend** (from repo root):

```bash
pip install -e upstream/sam3-original
pip install -r apps/sam3-demo-backend/requirements.txt
pip install -e apps/sam3-demo-backend

# login for gated model access (Hugging Face CLI)
hf auth login
# fallback if `hf` is not on PATH:
python3 -m huggingface_hub.cli.hf auth login
# or non-interactive:
# hf auth login --token <YOUR_HF_TOKEN>
# python3 -m huggingface_hub.cli.hf auth login --token <YOUR_HF_TOKEN>

python3 -m uvicorn app.main:app \
  --app-dir apps/sam3-demo-backend \
  --host 127.0.0.1 \
  --port 8000
```

**Frontend** (in a second terminal):

```bash
cd apps/sam3-demo-frontend
npm install
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Remote GPU Setup (Lambda Labs)

When running on a remote GPU VM without a public IP, use SSH tunneling:

**On the VM:**

```bash
cd ~/sam3
pip install -e upstream/sam3-original
pip install -r apps/sam3-demo-backend/requirements.txt
pip install -e apps/sam3-demo-backend

python3 -m uvicorn app.main:app \
  --app-dir apps/sam3-demo-backend \
  --host 127.0.0.1 \
  --port 8000
```

**On your laptop:**

```bash
ssh -L 8000:localhost:8000 ubuntu@<lambda-ip>
```

Then run the frontend locally pointing at `http://localhost:8000` (same as Quick Start).

---

## Configuration

All backend settings are configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SAM3_DEMO_TMP_DIR` | `tmp/sam3-demo` | Working directory for uploads and frames |
| `SAM3_DEMO_MAX_DURATION_SEC` | `60` | Maximum allowed video duration in seconds |
| `SAM3_DEMO_MAX_FRAMES` | `900` | Maximum extracted frames (FPS is downsampled to fit) |
| `SAM3_DEMO_DEFAULT_PROPAGATION_DIRECTION` | `both` | Backend default propagation direction setting (reserved; current UI sends direction explicitly) |
| `SAM3_DEMO_LOAD_MODEL_ON_STARTUP` | `0` | Set to `1` to preload the SAM3 model at startup |

---

## Current Limitations

This is a **single-user demo**, not a production system:

- One active session at a time (new upload replaces the previous)
- In-memory state only — lost on backend restart
- No user authentication (CORS allows all origins)
- Local file storage for uploads and frames
- No background job queue — processing is synchronous
- One propagation stream at a time per session

---

## Production Roadmap

The [production architecture doc](docs/production-architecture.md) outlines a four-phase scaling plan:

| Phase | Key Changes |
|-------|-------------|
| **Current** | Single user, in-memory state, local files |
| **Beta** | Redis session routing, object storage (S3), OIDC auth |
| **Public** | Multi-GPU worker pool, message queue, Postgres metadata, observability |
| **Scale** | Autoscaling, tenant quotas, async exports, cost-aware scheduling |

Key production concerns addressed: API gateway + WAF, sticky session routing to GPU workers, durable session checkpoints, per-tenant authorization, and dynamic GPU pool scaling.

---

## Technologies

| Layer | Technology |
|-------|------------|
| ML Model | SAM3 (PyTorch 2.7+, CUDA 12.6+) |
| Backend | FastAPI, Pydantic v2, FFmpeg/FFprobe |
| Frontend | Next.js 15, React 19, TypeScript 5.7, Canvas API |
| Mask Format | COCO RLE (pycocotools) |
| Real-time | WebSocket (propagation streaming) |
| Model Weights | Hugging Face Hub |


## AWS EC2 Instance

Using g5.2xlarge (NVIDIA A10)

AMI:
Deep Learning OSS Nvidia Driver AMI GPU PyTorch 2.7 (Ubuntu 22.04)

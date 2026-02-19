# SAM3 Demo Setup (Single User)

## What This Demo Is
- One active session at a time.
- Upload limit: **60 seconds**.
- Inference frame cap: **900 frames** (server-side fps downsampling).
- Timeline uses processed frames/fps (not original source fps when downsampled).
- Stored uploads are cataloged on disk and can be reloaded via the Storage panel.
- Export supports COCO instance, YOLO segmentation, and binary mask PNGs.
- Stored uploads are cataloged on disk and can be reloaded via the Storage panel.
- Export supports COCO instance, YOLO segmentation, and binary mask PNGs.

## Prerequisites
- Python 3.10+
- Node 20+
- `ffmpeg` + `ffprobe` available in `PATH`
- CUDA GPU VM for real inference
- SAM3 upstream package installed in env (`pip install -e upstream/sam3-original`)

## AWS EC2 Remote GPU Setup (Recommended)
### 1) Installation (on EC2)

From repo root:

```bash
cd ~/sam3-videoseg
# system deps
sudo apt-get update && sudo apt-get install -y ffmpeg

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
```

### 2) Run backend (on EC2)

```bash
cd ~/sam3-videoseg
python3 -m uvicorn app.main:app \
  --app-dir apps/sam3-demo-backend \
  --host 127.0.0.1 \
  --port 8000
```

Optional env vars:

```bash
export SAM3_DEMO_TMP_DIR=tmp/sam3-demo
export SAM3_DEMO_MAX_DURATION_SEC=60
export SAM3_DEMO_MAX_FRAMES=900
export SAM3_DEMO_DEFAULT_PROPAGATION_DIRECTION=both
export SAM3_DEMO_DEFAULT_PROPAGATION_DIRECTION=both
export SAM3_DEMO_LOAD_MODEL_ON_STARTUP=0
```

Quick backend test run:

```bash
pytest -q apps/sam3-demo-backend/tests
```

Quick backend test run:

```bash
pytest -q apps/sam3-demo-backend/tests
```

### 3) Open SSH tunnel (on your laptop)

```bash
ssh -L 8000:localhost:8000 ubuntu@<aws-ec2-ip>
```

### 4) Run frontend (on your laptop)

```bash
pytest -q apps/sam3-demo-backend/tests
```

Open `http://localhost:3000`.

## API Surface
- `GET /api/health`
- `GET /api/storage/status`
- `GET /api/storage/videos`
- `POST /api/storage/videos/{video_id}/load`
- `PATCH /api/storage/videos/{video_id}`
- `POST /api/storage/videos/delete`
- `GET /api/health`
- `GET /api/storage/status`
- `GET /api/storage/videos`
- `POST /api/storage/videos/{video_id}/load`
- `PATCH /api/storage/videos/{video_id}`
- `POST /api/storage/videos/delete`
- `POST /api/videos/upload`
- `GET /api/sessions/{session_id}/frames/{frame_index}.jpg`
- `POST /api/sessions/{session_id}/prompt/text`
- `POST /api/sessions/{session_id}/objects`
- `POST /api/sessions/{session_id}/prompt/clicks`
- `POST /api/sessions/{session_id}/objects/{obj_id}/remove`
- `POST /api/sessions/{session_id}/reset`
- `POST /api/sessions/{session_id}/exports`
- `POST /api/sessions/{session_id}/exports`
- `DELETE /api/sessions/{session_id}`
- `WS /api/sessions/{session_id}/propagate`

WebSocket start message:

```json
{ "action": "start", "direction": "both", "start_frame_index": null }
```

Export naming behavior:
- `class_name` controls category names in COCO and class names/index mapping in YOLO.
- `instance_name` is preserved per object in COCO annotations.

WebSocket start message:

```json
{ "action": "start", "direction": "both", "start_frame_index": null }
```

Export naming behavior:
- `class_name` controls category names in COCO and class names/index mapping in YOLO.
- `instance_name` is preserved per object in COCO annotations.

## Known Limitations
- Single-session, in-memory backend state.
- No user auth.
- No persistence across backend restarts.
- No background job queue.
- One propagation stream at a time per session.

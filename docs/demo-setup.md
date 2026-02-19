# SAM3 Demo Setup (Single User)

## What This Demo Is
- One active session at a time.
- Upload limit: **60 seconds**.
- Inference frame cap: **900 frames** (server-side fps downsampling).
- Timeline uses processed frames/fps (not original source fps when downsampled).

## Prerequisites
- Python 3.10+
- Node 20+
- `ffmpeg` + `ffprobe` available in `PATH`
- CUDA GPU VM for real inference
- SAM3 upstream package installed in env (`pip install -e upstream/sam3-original`)

## Local Backend Run
From repo root:

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

Optional env vars:

```bash
export SAM3_DEMO_TMP_DIR=tmp/sam3-demo
export SAM3_DEMO_MAX_DURATION_SEC=60
export SAM3_DEMO_MAX_FRAMES=900
export SAM3_DEMO_LOAD_MODEL_ON_STARTUP=0
```

## Local Frontend Run

```bash
cd apps/sam3-demo-frontend
npm install
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 npm run dev
```

Open `http://localhost:3000`.

## Lambda Labs Run (SSH Tunnel Only)
On Lambda VM:

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

On your laptop:

```bash
ssh -L 8000:localhost:8000 ubuntu@<lambda-ip>
```

Then start frontend locally with:

```bash
cd apps/sam3-demo-frontend
npm install
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 npm run dev
```

## API Surface
- `POST /api/videos/upload`
- `GET /api/sessions/{session_id}/frames/{frame_index}.jpg`
- `POST /api/sessions/{session_id}/prompt/text`
- `POST /api/sessions/{session_id}/objects`
- `POST /api/sessions/{session_id}/prompt/clicks`
- `POST /api/sessions/{session_id}/objects/{obj_id}/remove`
- `POST /api/sessions/{session_id}/reset`
- `DELETE /api/sessions/{session_id}`
- `WS /api/sessions/{session_id}/propagate`

## Known Limitations
- Single-session, in-memory backend state.
- No user auth.
- No persistence across backend restarts.
- No background job queue.
- One propagation stream at a time per session.

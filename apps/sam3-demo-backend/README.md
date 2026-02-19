# sam3-demo-backend

FastAPI backend for the SAM3 single-user interactive video segmentation demo.

## Responsibilities

- Video upload + frame extraction (`ffprobe`/`ffmpeg`)
- SAM3 session lifecycle (start/reset/close)
- Text and click prompting
- WebSocket propagation streaming
- Export ZIP generation (COCO instance, YOLO segmentation, binary mask PNG)
- Stored upload library management (`list/load/rename/delete`)

## Install

From repository root:

```bash
pip install -e upstream/sam3-original
pip install -r apps/sam3-demo-backend/requirements.txt
pip install -e apps/sam3-demo-backend
```

Authenticate for gated SAM3 weights:

```bash
hf auth login
# or:
python3 -m huggingface_hub.cli.hf auth login
```

## Run

```bash
python3 -m uvicorn app.main:app \
  --app-dir apps/sam3-demo-backend \
  --host 127.0.0.1 \
  --port 8000
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `SAM3_DEMO_TMP_DIR` | `tmp/sam3-demo` | Working directory root for uploads + extracted frames |
| `SAM3_DEMO_MAX_DURATION_SEC` | `60` | Maximum input video duration |
| `SAM3_DEMO_MAX_FRAMES` | `900` | Maximum processed frame count after FPS downsampling |
| `SAM3_DEMO_DEFAULT_PROPAGATION_DIRECTION` | `both` | Default propagation direction setting (UI currently sends explicit direction) |
| `SAM3_DEMO_LOAD_MODEL_ON_STARTUP` | `0` | Preload SAM3 model on startup when set to `1` |

## Test

```bash
pytest -q apps/sam3-demo-backend/tests
```

## API Summary

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
- `DELETE /api/sessions/{session_id}`
- `WS /api/sessions/{session_id}/propagate`

WebSocket start payload:

```json
{ "action": "start", "direction": "both", "start_frame_index": null }
```

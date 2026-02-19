# sam3-demo-backend

FastAPI backend for the SAM3 single-user demo.

## Dependency

Install upstream SAM3 first:

```bash
pip install -e upstream/sam3-original
pip install -r apps/sam3-demo-backend/requirements.txt
pip install -e apps/sam3-demo-backend
```

If `huggingface-cli` is not found, use:

```bash
hf auth login
# or if `hf` is not on PATH:
python3 -m huggingface_hub.cli.hf auth login
```

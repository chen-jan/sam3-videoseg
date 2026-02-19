# SAM3 Production Architecture

## Goals
- Multi-user, low-latency interactive video segmentation.
- Strong isolation between users/sessions.
- Predictable GPU utilization and cost controls.
- Reliable processing for short interactive jobs and long async jobs.

## Target System

## 1) Edge and API
- API gateway + WAF in front of all traffic.
- OIDC authentication (workspace/user identity).
- Rate limits per user and per org.
- Signed upload URLs for video ingestion.

## 2) Storage and Data Flow
- Object storage (S3/GCS) for raw videos, extracted frames, and exports.
- Redis for low-latency session routing/state pointers.
- Postgres for durable metadata (users, sessions, jobs, audit records).
- Optional CDN for serving static frames and assets.

## 3) Compute Layers
- Stateless API service (FastAPI/Go/Node) for orchestration.
- Preprocessing workers (ffprobe/ffmpeg) behind queue.
- GPU inference workers running SAM3 with sticky session assignment.
- Long-running export workers for offline mask rendering.

## 4) Queueing and Session Routing
- Message queue (SQS/Rabbit/Kafka) for preprocess and async propagate jobs.
- Session router maps `session_id -> gpu_worker_id` in Redis.
- Sticky routing ensures all interactive prompts for a session hit the same worker.
- Concurrency limits per GPU worker to avoid OOM.

## 5) Interactive Protocol
- WebSocket or WebRTC data channel for frame-by-frame mask streaming.
- Generation tokens for cancellation of stale propagations.
- Backpressure handling and dropped-frame policy under load.

## 6) Security Hardening
- OIDC + short-lived JWT access tokens.
- Per-tenant authorization checks on every session operation.
- Signed URLs with short TTL for uploads/downloads.
- Strict CORS and CSP policies.
- Secrets in cloud secret manager (no plaintext env in CI logs).

## 7) Observability and SLOs
- Metrics: p50/p95 prompt latency, propagation throughput, queue depth, GPU memory, GPU utilization.
- Structured logs with request/session IDs.
- Distributed tracing across API -> queue -> GPU workers.
- Alerts for error spikes, OOM, and stuck sessions.

## 8) Reliability
- Health probes for API and GPU workers.
- Graceful shutdown drains active sessions.
- Auto-recovery/retry for failed preprocessing jobs.
- Durable session checkpoints for reconnect/resume (optional phase 2).

## 9) Cost Controls
- Input policy tiers:
  - interactive tier (short clips, frame caps)
  - async tier (long-form videos)
- Auto-idle GPU pools when no active sessions.
- Dynamic model worker scaling by queue depth and SLO pressure.
- Resolution/fps caps by plan tier.

## 10) Migration Path from Current Demo
1. Current: single user, in-memory active session, local files, stored-upload manifest, synchronous export API.
2. Beta: Redis session routing + object storage + auth.
3. Public: multi-worker GPU pool + queue + Postgres + full observability.
4. Scale: autoscaling + tenant quotas + async exports + cost-aware scheduling.

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile


ALLOWED_VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


@dataclass(frozen=True)
class VideoMetadata:
    width: int
    height: int
    fps: float
    duration_sec: float


def parse_fps(value: str | None) -> float:
    if not value:
        return 0.0
    if "/" in value:
        numerator, denominator = value.split("/", maxsplit=1)
        try:
            num = float(numerator)
            den = float(denominator)
            if den == 0:
                return 0.0
            return num / den
        except ValueError:
            return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def run_command(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{proc.stderr}")


def probe_video(video_path: Path) -> VideoMetadata:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,avg_frame_rate,r_frame_rate,duration",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(video_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {proc.stderr}")

    data = json.loads(proc.stdout)
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format", {})

    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)

    fps = parse_fps(stream.get("avg_frame_rate"))
    if fps <= 0:
        fps = parse_fps(stream.get("r_frame_rate"))

    duration_raw = stream.get("duration") or fmt.get("duration") or 0
    try:
        duration_sec = float(duration_raw)
    except (TypeError, ValueError):
        duration_sec = 0.0

    if width <= 0 or height <= 0 or duration_sec <= 0:
        raise RuntimeError("Could not parse valid video metadata from input file")

    return VideoMetadata(width=width, height=height, fps=max(fps, 1.0), duration_sec=duration_sec)


def probe_image_size(image_path: Path) -> tuple[int, int]:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        str(image_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for image: {proc.stderr}")

    data = json.loads(proc.stdout)
    stream = (data.get("streams") or [{}])[0]
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError("Could not parse valid frame dimensions")
    return width, height


def is_duration_allowed(duration_sec: float, max_duration_sec: float) -> bool:
    return duration_sec <= max_duration_sec


def compute_processing_fps(
    source_fps: float,
    duration_sec: float,
    max_frames: int,
    requested_fps: float | None = None,
) -> float:
    source_fps = max(source_fps, 1.0)
    if duration_sec <= 0:
        upper_bound = source_fps
    else:
        upper_bound = min(source_fps, max_frames / duration_sec)
    upper_bound = max(upper_bound, 0.1)

    if requested_fps is None:
        return upper_bound

    fps = min(float(requested_fps), upper_bound)
    return max(fps, 0.1)


def extract_frames(
    video_path: Path,
    frames_dir: Path,
    processing_fps: float,
    max_frames: int,
) -> None:
    frames_dir.mkdir(parents=True, exist_ok=True)
    frame_pattern = str(frames_dir / "%06d.jpg")
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(video_path),
        "-vf",
        f"fps={processing_fps:.6f}",
        "-frames:v",
        str(max_frames),
        "-q:v",
        "2",
        "-start_number",
        "0",
        frame_pattern,
    ]
    run_command(cmd)


def count_extracted_frames(frames_dir: Path) -> int:
    return len(list(frames_dir.glob("*.jpg")))


def get_frame_path(frames_dir: Path, frame_index: int) -> Path:
    frame_path = frames_dir / f"{frame_index:06d}.jpg"
    if not frame_path.exists():
        raise FileNotFoundError(str(frame_path))
    return frame_path


async def save_upload_file(upload: UploadFile, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as f:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    await upload.close()


def cleanup_path(path: Path) -> None:
    if not path.exists():
        return
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    else:
        try:
            path.unlink()
        except FileNotFoundError:
            pass

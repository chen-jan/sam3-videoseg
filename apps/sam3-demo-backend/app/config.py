from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    tmp_dir: Path = Path(os.getenv("SAM3_DEMO_TMP_DIR", "tmp/sam3-demo"))
    max_duration_sec: float = float(os.getenv("SAM3_DEMO_MAX_DURATION_SEC", "60"))
    max_frames: int = int(os.getenv("SAM3_DEMO_MAX_FRAMES", "900"))
    default_propagation_direction: str = os.getenv(
        "SAM3_DEMO_DEFAULT_PROPAGATION_DIRECTION", "both"
    )
    load_model_on_startup: bool = (
        os.getenv("SAM3_DEMO_LOAD_MODEL_ON_STARTUP", "1") == "1"
    )

    @property
    def uploads_dir(self) -> Path:
        return self.tmp_dir / "uploads"

    @property
    def frames_dir(self) -> Path:
        return self.tmp_dir / "frames"


def ensure_directories(settings: Settings) -> None:
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    settings.frames_dir.mkdir(parents=True, exist_ok=True)

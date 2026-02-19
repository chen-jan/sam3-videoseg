from app.video_io import compute_processing_fps, is_duration_allowed


def test_duration_limit_rejects_over_60_seconds() -> None:
    assert not is_duration_allowed(60.01, 60.0)


def test_duration_limit_accepts_60_seconds() -> None:
    assert is_duration_allowed(60.0, 60.0)


def test_processing_fps_caps_to_900_frames_for_60_seconds() -> None:
    fps = compute_processing_fps(source_fps=30.0, duration_sec=60.0, max_frames=900)
    assert fps == 15.0


def test_processing_fps_keeps_source_fps_when_under_cap() -> None:
    fps = compute_processing_fps(source_fps=30.0, duration_sec=20.0, max_frames=900)
    assert fps == 30.0


def test_processing_fps_caps_high_source_fps() -> None:
    fps = compute_processing_fps(source_fps=120.0, duration_sec=60.0, max_frames=900)
    assert fps == 15.0


def test_processing_fps_respects_requested_fps_when_under_cap() -> None:
    fps = compute_processing_fps(
        source_fps=30.0,
        duration_sec=60.0,
        max_frames=900,
        requested_fps=8.5,
    )
    assert fps == 8.5


def test_processing_fps_clamps_requested_fps_to_cap() -> None:
    fps = compute_processing_fps(
        source_fps=30.0,
        duration_sec=60.0,
        max_frames=900,
        requested_fps=25.0,
    )
    assert fps == 15.0

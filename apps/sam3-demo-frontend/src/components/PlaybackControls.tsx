interface PlaybackControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepBackward: () => void;
  onStepForward: () => void;
  processingFps: number;
  currentFrame: number;
  totalFrames: number;
  onFrameChange: (frame: number) => void;
}

export function PlaybackControls({
  isPlaying,
  onTogglePlay,
  onStepBackward,
  onStepForward,
  processingFps,
  currentFrame,
  totalFrames,
  onFrameChange,
}: PlaybackControlsProps) {
  const maxFrame = Math.max(totalFrames - 1, 0);
  const clampedFrame = Math.min(Math.max(currentFrame, 0), maxFrame);
  const canStepBackward = clampedFrame > 0;
  const canStepForward = clampedFrame < maxFrame;

  return (
    <div className="playback-bar">
      <div className="playback-bar__top-row">
        <div className="playback-bar__buttons" role="toolbar" aria-label="Playback controls">
          <button onClick={onTogglePlay}>{isPlaying ? "Pause" : "Play"}</button>
          <button onClick={onStepBackward} disabled={!canStepBackward}>
            Prev
          </button>
          <button onClick={onStepForward} disabled={!canStepForward}>
            Next
          </button>
        </div>

        <div className="playback-bar__meta">
          <span>
            Frame {clampedFrame} / {maxFrame}
          </span>
          <span>Playback FPS: {processingFps.toFixed(2)}</span>
        </div>
      </div>

      <input
        className="playback-bar__slider"
        type="range"
        min={0}
        max={maxFrame}
        value={clampedFrame}
        onChange={(event) => onFrameChange(Number(event.target.value))}
        aria-label="Current frame"
      />
    </div>
  );
}

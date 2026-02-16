interface PlaybackControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepBackward: () => void;
  onStepForward: () => void;
  processingFps: number;
}

export function PlaybackControls({
  isPlaying,
  onTogglePlay,
  onStepBackward,
  onStepForward,
  processingFps,
}: PlaybackControlsProps) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button onClick={onTogglePlay}>{isPlaying ? "Pause" : "Play"}</button>
      <button onClick={onStepBackward}>Prev</button>
      <button onClick={onStepForward}>Next</button>
      <span style={{ color: "#666" }}>Playback FPS: {processingFps.toFixed(2)}</span>
    </div>
  );
}

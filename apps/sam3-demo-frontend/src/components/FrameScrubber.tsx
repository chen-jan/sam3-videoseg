interface FrameScrubberProps {
  currentFrame: number;
  totalFrames: number;
  onChange: (frame: number) => void;
}

export function FrameScrubber({
  currentFrame,
  totalFrames,
  onChange,
}: FrameScrubberProps) {
  const maxFrame = Math.max(totalFrames - 1, 0);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div>
        Frame: {currentFrame} / {maxFrame}
      </div>
      <input
        type="range"
        min={0}
        max={maxFrame}
        value={Math.min(currentFrame, maxFrame)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

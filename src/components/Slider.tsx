interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  onDragChange?: (dragging: boolean) => void;
}

export default function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue = 0,
  onChange,
  format,
  onDragChange,
}: SliderProps) {
  const shown = format ? format(value) : String(Math.round(value * 100) / 100);
  const decimals = (String(step).split(".")[1] ?? "").length;
  const stepBy = (dir: 1 | -1) => {
    const next = Math.min(max, Math.max(min, value + dir * step));
    onChange(Number(next.toFixed(decimals)));
  };
  return (
    <div className="slider">
      <div className="slider-head" onDoubleClick={() => onChange(defaultValue)} title="Double-click to reset">
        <span className="slider-label">{label}</span>
        <span className="slider-val">{shown}</span>
      </div>
      <div className="slider-row">
        <button className="slider-step" title="Decrease" onClick={() => stepBy(-1)}>
          −
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
          onPointerDown={() => {
            if (!onDragChange) return;
            onDragChange(true);
            window.addEventListener("pointerup", () => onDragChange(false), { once: true });
          }}
        />
        <button className="slider-step" title="Increase" onClick={() => stepBy(1)}>
          +
        </button>
      </div>
    </div>
  );
}

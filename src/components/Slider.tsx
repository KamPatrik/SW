interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
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
}: SliderProps) {
  const shown = format ? format(value) : String(Math.round(value * 100) / 100);
  return (
    <div className="slider">
      <div className="slider-head" onDoubleClick={() => onChange(defaultValue)} title="Double-click to reset">
        <span className="slider-label">{label}</span>
        <span className="slider-val">{shown}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
      />
    </div>
  );
}

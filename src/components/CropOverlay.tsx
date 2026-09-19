import { useRef } from "react";
import type { CropRect } from "../types";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

const MIN = 0.05;

export default function CropOverlay({
  crop,
  onChange,
  ratioFactor,
}: {
  crop: CropRect | null;
  onChange: (c: CropRect) => void;
  ratioFactor?: number | null; // hNorm = wNorm * ratioFactor; null = free
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; startX: number; startY: number; start: CropRect } | null>(null);

  const rect: CropRect = crop ?? { x: 0, y: 0, w: 1, h: 1 };

  const begin = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: { ...rect } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const bounds = el.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / bounds.width;
    const dy = (e.clientY - d.startY) / bounds.height;
    const s = d.start;
    let { x, y, w, h } = s;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    if (d.handle === "move") {
      x = clamp(s.x + dx, 0, 1 - s.w);
      y = clamp(s.y + dy, 0, 1 - s.h);
    } else {
      if (d.handle.includes("w")) {
        const nx = clamp(s.x + dx, 0, s.x + s.w - MIN);
        w = s.w + (s.x - nx);
        x = nx;
      }
      if (d.handle.includes("e")) {
        w = clamp(s.w + dx, MIN, 1 - s.x);
      }
      if (d.handle.includes("n")) {
        const ny = clamp(s.y + dy, 0, s.y + s.h - MIN);
        h = s.h + (s.y - ny);
        y = ny;
      }
      if (d.handle.includes("s")) {
        h = clamp(s.h + dy, MIN, 1 - s.y);
      }
      const f = ratioFactor ?? null;
      if (f !== null && f > 0) {
        if (d.handle === "n" || d.handle === "s") {
          w = h / f;
        } else {
          h = w * f;
        }
        if (d.handle.includes("n")) y = s.y + s.h - h;
        if (d.handle.includes("w")) x = s.x + s.w - w;
        // keep the locked rect inside the image
        if (x < 0) {
          w += x;
          x = 0;
          h = w * f;
          if (d.handle.includes("n")) y = s.y + s.h - h;
        }
        if (y < 0) {
          h += y;
          y = 0;
          w = h / f;
          if (d.handle.includes("w")) x = s.x + s.w - w;
        }
        if (x + w > 1) {
          w = 1 - x;
          h = w * f;
          if (d.handle.includes("n")) y = s.y + s.h - h;
        }
        if (y + h > 1) {
          h = 1 - y;
          w = h / f;
          if (d.handle.includes("w")) x = s.x + s.w - w;
        }
      }
    }
    onChange({ x, y, w, h });
  };

  const pct = (v: number) => `${v * 100}%`;

  return (
    <div className="crop-overlay" ref={ref} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
      <div
        className="crop-rect"
        style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
        onPointerDown={begin("move")}
      >
        <div className="crop-third v" style={{ left: "33.33%" }} />
        <div className="crop-third v" style={{ left: "66.66%" }} />
        <div className="crop-third h" style={{ top: "33.33%" }} />
        <div className="crop-third h" style={{ top: "66.66%" }} />
        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).map((hd) => (
          <div key={hd} className={`crop-handle ${hd}`} onPointerDown={begin(hd)} />
        ))}
      </div>
    </div>
  );
}

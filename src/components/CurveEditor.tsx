import { useRef, useState } from "react";

type Pt = [number, number];

const SIZE = 256;
const PAD = 10;

// Fritsch–Carlson monotone cubic tangents (mirrors the Rust engine).
function tangents(pts: Pt[]): number[] {
  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(1e-6, pts[i + 1][0] - pts[i][0]));
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }
  return m;
}

function evalCurve(pts: Pt[], m: number[], x: number): number {
  let seg = 0;
  while (seg < pts.length - 2 && x > pts[seg + 1][0]) seg++;
  const h = Math.max(1e-6, pts[seg + 1][0] - pts[seg][0]);
  const t = Math.min(1, Math.max(0, (x - pts[seg][0]) / h));
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const y = h00 * pts[seg][1] + h10 * h * m[seg] + h01 * pts[seg + 1][1] + h11 * h * m[seg + 1];
  return Math.min(1, Math.max(0, y));
}

const toPx = (v: number) => PAD + v * (SIZE - 2 * PAD);
const toPxY = (v: number) => SIZE - PAD - v * (SIZE - 2 * PAD);
const fromPx = (px: number) => Math.min(1, Math.max(0, (px - PAD) / (SIZE - 2 * PAD)));

export default function CurveEditor({
  points,
  onChange,
}: {
  points: Pt[];
  onChange: (pts: Pt[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const pts: Pt[] =
    points.length >= 2 ? points : [[0, 0], [1, 1]];
  const m = tangents(pts);

  let path = "";
  for (let i = 0; i <= 64; i++) {
    const x = i / 64;
    const y = evalCurve(pts, m, x);
    path += (i === 0 ? "M" : "L") + toPx(x).toFixed(1) + "," + toPxY(y).toFixed(1);
  }

  const svgCoords = (e: React.PointerEvent): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE;
    return [fromPx(x), 1 - fromPx(y)] as Pt;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIdx === null) return;
    const [x, y] = svgCoords(e);
    const next = pts.map((p) => [...p] as Pt);
    const isFirst = dragIdx === 0;
    const isLast = dragIdx === pts.length - 1;
    const minX = isFirst ? 0 : next[dragIdx - 1][0] + 0.02;
    const maxX = isLast ? 1 : next[dragIdx + 1][0] - 0.02;
    next[dragIdx] = [
      isFirst ? 0 : isLast ? 1 : Math.min(maxX, Math.max(minX, x)),
      Math.min(1, Math.max(0, y)),
    ];
    onChange(next);
  };

  const onDblClick = (e: React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = fromPx(((e.clientX - rect.left) / rect.width) * SIZE);
    const y = 1 - fromPx(((e.clientY - rect.top) / rect.height) * SIZE);
    // near an existing interior point -> remove it
    const hit = pts.findIndex(
      (p, i) => i > 0 && i < pts.length - 1 && Math.hypot(p[0] - x, p[1] - y) < 0.06,
    );
    if (hit >= 0) {
      onChange(pts.filter((_, i) => i !== hit));
      return;
    }
    const next = [...pts.map((p) => [...p] as Pt), [x, y] as Pt].sort((a, b) => a[0] - b[0]);
    onChange(next);
  };

  return (
    <svg
      ref={svgRef}
      className="curve-editor"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragIdx(null)}
      onPointerLeave={() => setDragIdx(null)}
      onDoubleClick={onDblClick}
    >
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g}>
          <line x1={toPx(g)} y1={PAD} x2={toPx(g)} y2={SIZE - PAD} className="curve-grid" />
          <line x1={PAD} y1={toPxY(g)} x2={SIZE - PAD} y2={toPxY(g)} className="curve-grid" />
        </g>
      ))}
      <line x1={toPx(0)} y1={toPxY(0)} x2={toPx(1)} y2={toPxY(1)} className="curve-diag" />
      <path d={path} className="curve-line" />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={toPx(p[0])}
          cy={toPxY(p[1])}
          r={6}
          className={dragIdx === i ? "curve-pt drag" : "curve-pt"}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setDragIdx(i);
          }}
        />
      ))}
    </svg>
  );
}

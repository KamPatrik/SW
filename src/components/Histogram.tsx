import { useEffect, useRef } from "react";
import type { HistogramData } from "../types";

const W = 256;
const H = 96;

function drawChannel(
  ctx: CanvasRenderingContext2D,
  bins: number[],
  max: number,
  color: string,
) {
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let i = 0; i < bins.length; i++) {
    const x = (i / (bins.length - 1)) * W;
    const y = H - Math.sqrt(bins[i] / max) * H;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export default function Histogram({ data }: { data: HistogramData | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#141519";
    ctx.fillRect(0, 0, W, H);
    if (!data) return;
    const max = Math.max(1, ...data.r, ...data.g, ...data.b, ...data.l);
    ctx.globalCompositeOperation = "source-over";
    drawChannel(ctx, data.l, max, "rgba(200,200,200,0.25)");
    ctx.globalCompositeOperation = "screen";
    drawChannel(ctx, data.r, max, "rgba(220,70,60,0.55)");
    drawChannel(ctx, data.g, max, "rgba(80,200,90,0.55)");
    drawChannel(ctx, data.b, max, "rgba(70,110,230,0.55)");
    ctx.globalCompositeOperation = "source-over";
  }, [data]);

  return <canvas className="histogram" ref={ref} width={W} height={H} />;
}

import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import * as api from "../api";
import { filteredPhotos, useStore } from "../store";
import { cloneRecipe, DEFAULT_RECIPE, type RenderResult } from "../types";
import CropOverlay from "./CropOverlay";
import Panels from "./Panels";

function Filmstrip() {
  const photos = useStore(useShallow(filteredPhotos));
  const activeId = useStore((s) => s.activeId);
  const thumbs = useStore((s) => s.thumbs);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    photos.forEach((p) => useStore.getState().requestThumb(p.id));
  }, [photos]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  const idx = photos.findIndex((p) => p.id === activeId);

  return (
    <>
      <div className="filmstrip">
        {photos.map((p) => (
          <div
            key={p.id}
            ref={p.id === activeId ? activeRef : undefined}
            className={p.id === activeId ? "strip-thumb active" : "strip-thumb"}
            onClick={() => void useStore.getState().loadRecipeFor(p.id)}
            title={p.filename}
          >
            {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" draggable={false} /> : <span>…</span>}
          </div>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="strip-nav">
          <input
            type="range"
            min={1}
            max={photos.length}
            step={1}
            value={idx >= 0 ? idx + 1 : 1}
            title="Scrub through the current folder / filter"
            onChange={(e) => {
              const p = photos[Number(e.target.value) - 1];
              if (p && p.id !== activeId) void useStore.getState().loadRecipeFor(p.id);
            }}
          />
          <span className="strip-pos">
            {idx >= 0 ? idx + 1 : "–"} / {photos.length}
            {idx >= 0 && idx < photos.length - 1 && (
              <span className="strip-left"> · {photos.length - idx - 1} left</span>
            )}
          </span>
        </div>
      )}
    </>
  );
}

function segDistPx(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 <= 1e-6 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export default function DevelopView() {
  const activeId = useStore((s) => s.activeId);
  const activePhoto = useStore((s) =>
    s.activeId === null ? null : s.photos.find((p) => p.id === s.activeId) ?? null,
  );
  const recipe = useStore((s) => s.recipe);
  const recipeFor = useStore((s) => s.recipeFor);
  const tool = useStore((s) => s.tool);
  const spotRadius = useStore((s) => s.spotRadius);
  const gridVisible = useStore((s) => s.gridVisible);
  const canUndo = useStore((s) => s.history.length > 0);
  const showBefore = useStore((s) => s.showBefore);
  const hasClipboard = useStore((s) => s.settingsClipboard !== null);
  const cropAspect = useStore((s) => s.cropAspect);
  const updateRecipe = useStore((s) => s.updateRecipe);
  const updateNegative = useStore((s) => s.updateNegative);
  const setTool = useStore((s) => s.setTool);

  const [preview, setPreview] = useState<RenderResult | null>(null);
  const [before, setBefore] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const seqRef = useRef(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const [zoom, setZoom] = useState<number | null>(null); // null = fit to stage
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ startX: number; startY: number; px: number; py: number } | null>(null);

  const strokeRef = useRef<{ pts: { x: number; y: number }[]; moved: boolean; hit: number } | null>(
    null,
  );
  const [stroke, setStroke] = useState<{ x: number; y: number }[] | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState("");

  useEffect(() => {
    setZoom(null);
    setPan({ x: 0, y: 0 });
    setEditingName(false);
    setBefore(null);
  }, [activeId]);

  // warm the decode cache for filmstrip neighbours — arrow keys feel instant
  useEffect(() => {
    if (activeId === null) return;
    const t = setTimeout(() => {
      const ph = filteredPhotos(useStore.getState());
      const idx = ph.findIndex((p) => p.id === activeId);
      if (idx < 0) return;
      for (const n of [idx + 1, idx - 1]) {
        const p = ph[n];
        if (p) void api.prefetchPhoto(p.id).catch(() => {});
      }
    }, 400);
    return () => clearTimeout(t);
  }, [activeId]);

  // lazy "before" render (original with default recipe) for the \ comparison
  useEffect(() => {
    if (!showBefore || before !== null || activeId === null) return;
    api
      .renderPreview(activeId, cloneRecipe(DEFAULT_RECIPE), false)
      .then(setBefore)
      .catch(console.error);
  }, [showBefore, before, activeId]);

  // conform existing crop when an aspect ratio is chosen
  useEffect(() => {
    if (tool !== "crop" || !preview || cropAspect === "free") return;
    const imgRatio = preview.width / preview.height;
    const target =
      cropAspect === "original"
        ? imgRatio
        : (() => {
            const [a, b] = cropAspect.split(":").map(Number);
            return a && b ? a / b : imgRatio;
          })();
    const f = imgRatio / target; // hNorm = wNorm * f
    const c = recipe.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    let w = c.w;
    let h = w * f;
    if (h > 1) {
      h = 1;
      w = h / f;
    }
    const x = Math.min(c.x, 1 - w);
    const y = Math.min(c.y, 1 - h);
    updateRecipe({ crop: { x, y, w, h } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropAspect, tool]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStage({ w: el.clientWidth - 24, h: el.clientHeight - 24 });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (activeId === null || recipeFor !== activeId) return;
    const seq = ++seqRef.current;
    setRendering(true);
    const t = setTimeout(() => {
      api
        .renderPreview(activeId, recipe, tool === "crop")
        .then((res) => {
          if (seqRef.current === seq) setPreview(res);
        })
        .catch(console.error)
        .finally(() => {
          if (seqRef.current === seq) setRendering(false);
        });
    }, 130);
    return () => clearTimeout(t);
  }, [activeId, recipe, recipeFor, tool]);

  // while comparing, the "before" render drives the canvas size
  const shown = showBefore && before ? before : preview;
  const fitScale =
    shown && stage.w > 0 && stage.h > 0
      ? Math.min(stage.w / shown.width, stage.h / shown.height)
      : 0;
  const scale = zoom ?? fitScale;
  const dispW = shown ? Math.max(1, shown.width * scale) : 0;
  const dispH = shown ? Math.max(1, shown.height * scale) : 0;

  const clampPan = (p: { x: number; y: number }, sc: number) => {
    if (!shown) return p;
    const mw = Math.max(0, (shown.width * sc - stage.w) / 2 + 20);
    const mh = Math.max(0, (shown.height * sc - stage.h) / 2 + 20);
    return { x: Math.min(mw, Math.max(-mw, p.x)), y: Math.min(mh, Math.max(-mh, p.y)) };
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!shown || fitScale <= 0) return;
    const cur = scale;
    let next = cur * (e.deltaY < 0 ? 1.25 : 0.8);
    next = Math.min(4, Math.max(Math.min(fitScale, 4) * 0.5, next));
    if (Math.abs(next - fitScale) / fitScale < 0.08) {
      setZoom(null);
      setPan({ x: 0, y: 0 });
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) {
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const ratio = next / cur;
      setPan((p) => clampPan({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }, next));
    }
    setZoom(next);
  };

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (tool !== "none" || zoom === null) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, px: pan.x, py: pan.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onStagePointerMove = (e: React.PointerEvent) => {
    const d = panRef.current;
    if (!d) return;
    setPan(clampPan({ x: d.px + e.clientX - d.startX, y: d.py + e.clientY - d.startY }, scale));
  };
  const onStagePointerUp = () => {
    panRef.current = null;
  };

  const normCoords = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  // spots/red-eye are stored in pre-crop coordinates; the display may be cropped
  const cropRect = tool !== "crop" ? recipe.crop : null;
  const cw = cropRect?.w ?? 1;
  const toStored = (p: { x: number; y: number }) =>
    cropRect
      ? { x: cropRect.x + p.x * cropRect.w, y: cropRect.y + p.y * cropRect.h }
      : p;
  const fsx = (x: number) => (cropRect ? (x - cropRect.x) / cropRect.w : x);
  const fsy = (y: number) => (cropRect ? (y - cropRect.y) / cropRect.h : y);

  const hitSpot = (x: number, y: number): number =>
    recipe.spots.findIndex((s) => {
      const px = x * dispW;
      const py = y * dispH;
      let d = Infinity;
      if (s.path && s.path.length >= 2) {
        for (let i = 0; i + 1 < s.path.length; i++) {
          d = Math.min(
            d,
            segDistPx(
              px,
              py,
              fsx(s.path[i][0]) * dispW,
              fsy(s.path[i][1]) * dispH,
              fsx(s.path[i + 1][0]) * dispW,
              fsy(s.path[i + 1][1]) * dispH,
            ),
          );
        }
      } else {
        d = segDistPx(
          px,
          py,
          fsx(s.x) * dispW,
          fsy(s.y) * dispH,
          fsx(s.x2 ?? s.x) * dispW,
          fsy(s.y2 ?? s.y) * dispH,
        );
      }
      return d <= (s.radius / cw) * dispW + 4;
    });

  const hitEye = (x: number, y: number): number =>
    recipe.redeye.findIndex(
      (s) =>
        Math.hypot((x - fsx(s.x)) * dispW, (y - fsy(s.y)) * dispH) <=
        (s.radius / cw) * dispW + 4,
    );

  const onSpotPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== "spot" && tool !== "redeye") return;
    e.stopPropagation();
    const c = normCoords(e);
    strokeRef.current = {
      pts: [c],
      moved: false,
      hit: tool === "spot" ? hitSpot(c.x, c.y) : hitEye(c.x, c.y),
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onSpotPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = strokeRef.current;
    if (!st || tool !== "spot") return;
    const c = normCoords(e);
    const last = st.pts[st.pts.length - 1];
    if (Math.hypot((c.x - last.x) * dispW, (c.y - last.y) * dispH) > 4) {
      st.pts.push(c);
      const first = st.pts[0];
      if (Math.hypot((c.x - first.x) * dispW, (c.y - first.y) * dispH) > 5) st.moved = true;
      setStroke([...st.pts]);
    }
  };
  const onSpotPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = strokeRef.current;
    strokeRef.current = null;
    setStroke(null);
    if (!st) return;
    const c = normCoords(e);
    if (tool === "redeye") {
      if (st.hit >= 0) {
        updateRecipe({ redeye: recipe.redeye.filter((_, i) => i !== st.hit) });
      } else {
        const sp = toStored(c);
        updateRecipe({
          redeye: [
            ...recipe.redeye,
            { x: sp.x, y: sp.y, radius: spotRadius * cw, x2: null, y2: null, path: null },
          ],
        });
      }
      return;
    }
    if (tool !== "spot") return;
    if (st.moved && st.pts.length >= 2) {
      // freehand stroke: cap point count, store in pre-crop coordinates
      const maxPts = 64;
      const step = Math.max(1, Math.ceil(st.pts.length / maxPts));
      const sampled = st.pts.filter((_, i) => i % step === 0);
      const lastPt = st.pts[st.pts.length - 1];
      if (sampled[sampled.length - 1] !== lastPt) sampled.push(lastPt);
      const path = sampled.map((p) => {
        const sp = toStored(p);
        return [sp.x, sp.y] as [number, number];
      });
      updateRecipe({
        spots: [
          ...recipe.spots,
          { x: path[0][0], y: path[0][1], radius: spotRadius * cw, x2: null, y2: null, path },
        ],
      });
    } else if (st.hit >= 0) {
      updateRecipe({ spots: recipe.spots.filter((_, i) => i !== st.hit) });
    } else {
      const a = toStored(c);
      updateRecipe({
        spots: [
          ...recipe.spots,
          { x: a.x, y: a.y, radius: spotRadius * cw, x2: null, y2: null, path: null },
        ],
      });
    }
  };

  const onImageClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeId === null || (tool !== "pickBase" && tool !== "pickWb")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    try {
      if (tool === "pickBase") {
        const c = await api.sampleBaseColor(activeId, x, y, recipe, false);
        updateNegative({ filmBase: c, enabled: true });
      } else {
        const [r, g, b] = await api.sampleWbColor(activeId, x, y, recipe, false);
        if (r > 1e-4 && g > 1e-4 && b > 1e-4) {
          // solve r(1+0.4t) = b(1-0.4t), then match green via tint
          let t = (b - r) / (0.4 * (r + b));
          t = Math.max(-1, Math.min(1, t));
          const m = r * (1 + 0.4 * t);
          let gt = (1 - m / g) / 0.3;
          gt = Math.max(-1, Math.min(1, gt));
          updateRecipe({ wbTemp: Math.round(t * 100), wbTint: Math.round(gt * 100) });
        }
      }
    } catch (err) {
      console.error(err);
    }
    setTool(tool); // same tool toggles off
  };

  const commitName = () => {
    setEditingName(false);
    const v = nameVal.trim();
    if (!activePhoto || !v) return;
    const dotIdx = activePhoto.filename.lastIndexOf(".");
    const stem = dotIdx > 0 ? activePhoto.filename.slice(0, dotIdx) : activePhoto.filename;
    if (v === stem) return;
    void useStore.getState().renameActive(v);
  };

  if (activeId === null) {
    return (
      <div className="develop">
        <div className="empty">Select a photo in the Library first.</div>
      </div>
    );
  }

  const cursor =
    tool === "pickBase" || tool === "pickWb" || tool === "redeye"
      ? "crosshair"
      : tool === "spot"
        ? "cell"
        : zoom !== null
          ? "grab"
          : "default";


  const dotIdx = activePhoto ? activePhoto.filename.lastIndexOf(".") : -1;
  const nameStem = activePhoto
    ? dotIdx > 0
      ? activePhoto.filename.slice(0, dotIdx)
      : activePhoto.filename
    : "";
  const nameExt = activePhoto && dotIdx > 0 ? activePhoto.filename.slice(dotIdx) : "";

  return (
    <div className="develop">
      <div className="develop-main">
        <div className="develop-bar">
          {editingName ? (
            <span className="fname">
              <input
                className="fname-input"
                value={nameVal}
                autoFocus
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                onBlur={commitName}
              />
              <span className="fname-ext">{nameExt}</span>
            </span>
          ) : (
            <span
              className="fname"
              title="Click to rename"
              onClick={() => {
                setNameVal(nameStem);
                setEditingName(true);
              }}
            >
              {activePhoto?.filename ?? ""}
              <span className="fname-edit">✎</span>
            </span>
          )}
          <span className="zoom-controls">
            <button
              className="btn small"
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              onClick={() => useStore.getState().undo()}
            >
              ↩ Undo
            </button>
            <button
              className="btn small"
              title="Copy settings (Ctrl+Shift+C) — tone, colour & negative, not crop/spots"
              onClick={() => useStore.getState().copySettings()}
            >
              Copy
            </button>
            <button
              className="btn small"
              disabled={!hasClipboard}
              title="Paste settings to selection (Ctrl+Shift+V)"
              onClick={() => void useStore.getState().pasteSettings()}
            >
              Paste
            </button>
            <button
              className={showBefore ? "btn small on" : "btn small"}
              title="Hold to compare with original (\)"
              onPointerDown={() => useStore.getState().setShowBefore(true)}
              onPointerUp={() => useStore.getState().setShowBefore(false)}
              onPointerLeave={() => useStore.getState().setShowBefore(false)}
            >
              Before
            </button>
            <button
              className={zoom === null ? "btn small on" : "btn small"}
              onClick={() => {
                setZoom(null);
                setPan({ x: 0, y: 0 });
              }}
            >
              Fit
            </button>
            <button
              className={zoom === 1 ? "btn small on" : "btn small"}
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              100%
            </button>
            <span className="zoom-pct">{scale > 0 ? Math.round(scale * 100) + "%" : ""}</span>
          </span>
        </div>
        <div
          className="preview-stage"
          ref={stageRef}
          onWheel={onWheel}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
        >
          {shown && scale > 0 ? (
            <div
              className="preview-wrap"
              style={{
                width: dispW,
                height: dispH,
                cursor,
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
              onClick={(e) => void onImageClick(e)}
              onDoubleClick={() => {
                if (tool !== "none") return;
                if (zoom === null) {
                  setZoom(1);
                } else {
                  setZoom(null);
                  setPan({ x: 0, y: 0 });
                }
              }}
              onPointerDown={onSpotPointerDown}
              onPointerMove={onSpotPointerMove}
              onPointerUp={onSpotPointerUp}
            >
              <img src={shown.dataUrl} alt="" draggable={false} />
              {showBefore && before && <span className="before-label">Before</span>}
              {tool === "spot" && (
                <svg className="spot-overlay" viewBox={`0 0 ${dispW} ${dispH}`}>
                  {recipe.spots.map((s, i) =>
                    s.path && s.path.length >= 2 ? (
                      <polyline
                        key={i}
                        points={s.path
                          .map((p) => `${fsx(p[0]) * dispW},${fsy(p[1]) * dispH}`)
                          .join(" ")}
                        className="spot-stroke"
                        fill="none"
                        strokeWidth={(s.radius / cw) * dispW * 2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : s.x2 != null && s.y2 != null ? (
                      <line
                        key={i}
                        x1={fsx(s.x) * dispW}
                        y1={fsy(s.y) * dispH}
                        x2={fsx(s.x2) * dispW}
                        y2={fsy(s.y2) * dispH}
                        className="spot-stroke"
                        strokeWidth={(s.radius / cw) * dispW * 2}
                        strokeLinecap="round"
                      />
                    ) : (
                      <circle
                        key={i}
                        cx={fsx(s.x) * dispW}
                        cy={fsy(s.y) * dispH}
                        r={(s.radius / cw) * dispW}
                        className="spot-circle"
                      />
                    ),
                  )}
                  {stroke && stroke.length >= 2 && (
                    <polyline
                      points={stroke.map((p) => `${p.x * dispW},${p.y * dispH}`).join(" ")}
                      className="spot-stroke live"
                      fill="none"
                      strokeWidth={spotRadius * dispW * 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
              )}
              {tool === "redeye" && (
                <svg className="spot-overlay" viewBox={`0 0 ${dispW} ${dispH}`}>
                  {recipe.redeye.map((s, i) => (
                    <circle
                      key={i}
                      cx={fsx(s.x) * dispW}
                      cy={fsy(s.y) * dispH}
                      r={(s.radius / cw) * dispW}
                      className="redeye-circle"
                    />
                  ))}
                </svg>
              )}
              {gridVisible && (
                <svg className="grid-overlay" viewBox={`0 0 ${dispW} ${dispH}`}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <g key={i}>
                      <line
                        x1={(dispW * i) / 6}
                        y1={0}
                        x2={(dispW * i) / 6}
                        y2={dispH}
                        className={i === 2 || i === 4 ? "grid-line strong" : "grid-line"}
                      />
                      <line
                        x1={0}
                        y1={(dispH * i) / 6}
                        x2={dispW}
                        y2={(dispH * i) / 6}
                        className={i === 2 || i === 4 ? "grid-line strong" : "grid-line"}
                      />
                    </g>
                  ))}
                </svg>
              )}
              {tool === "crop" && (
                <CropOverlay
                  crop={recipe.crop}
                  ratioFactor={(() => {
                    if (cropAspect === "free" || !preview) return null;
                    const imgRatio = preview.width / preview.height;
                    if (cropAspect === "original") return 1;
                    const [a, b] = cropAspect.split(":").map(Number);
                    return a && b ? imgRatio / (a / b) : null;
                  })()}
                  onChange={(c) => updateRecipe({ crop: c })}
                />
              )}
            </div>
          ) : (
            <div className="preview-loading">Loading…</div>
          )}
          {rendering && <div className="render-spinner" />}
        </div>
        <Filmstrip />
      </div>
      <aside className="develop-side">
        <Panels histogram={shown?.histogram ?? null} />
      </aside>
    </div>
  );
}

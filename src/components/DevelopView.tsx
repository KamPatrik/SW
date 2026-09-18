import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import * as api from "../api";
import { filteredPhotos, useStore } from "../store";
import type { RenderResult } from "../types";
import CropOverlay from "./CropOverlay";
import Panels from "./Panels";

function Filmstrip() {
  const photos = useStore(useShallow(filteredPhotos));
  const activeId = useStore((s) => s.activeId);
  const thumbs = useStore((s) => s.thumbs);

  useEffect(() => {
    photos.forEach((p) => useStore.getState().requestThumb(p.id));
  }, [photos]);

  return (
    <div className="filmstrip">
      {photos.map((p) => (
        <div
          key={p.id}
          className={p.id === activeId ? "strip-thumb active" : "strip-thumb"}
          onClick={() => void useStore.getState().loadRecipeFor(p.id)}
          title={p.filename}
        >
          {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" draggable={false} /> : <span>…</span>}
        </div>
      ))}
    </div>
  );
}

export default function DevelopView() {
  const activeId = useStore((s) => s.activeId);
  const recipe = useStore((s) => s.recipe);
  const recipeFor = useStore((s) => s.recipeFor);
  const tool = useStore((s) => s.tool);
  const spotRadius = useStore((s) => s.spotRadius);
  const updateRecipe = useStore((s) => s.updateRecipe);
  const updateNegative = useStore((s) => s.updateNegative);
  const setTool = useStore((s) => s.setTool);

  const [preview, setPreview] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const seqRef = useRef(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

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

  const fit =
    preview && stage.w > 0
      ? (() => {
          const scale = Math.min(stage.w / preview.width, stage.h / preview.height);
          return { w: Math.max(1, preview.width * scale), h: Math.max(1, preview.height * scale) };
        })()
      : null;

  const onImageClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!fit || activeId === null || tool === "crop" || tool === "none") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (tool === "pickBase") {
      try {
        const c = await api.sampleBaseColor(activeId, x, y, recipe, false);
        updateNegative({ filmBase: c, enabled: true });
      } catch (err) {
        console.error(err);
      }
      setTool("pickBase"); // same tool toggles off
    } else if (tool === "spot") {
      const hit = recipe.spots.findIndex((s) => {
        const dx = (s.x - x) * fit.w;
        const dy = (s.y - y) * fit.h;
        return Math.hypot(dx, dy) <= s.radius * fit.w + 4;
      });
      if (hit >= 0) updateRecipe({ spots: recipe.spots.filter((_, i) => i !== hit) });
      else updateRecipe({ spots: [...recipe.spots, { x, y, radius: spotRadius }] });
    }
  };

  if (activeId === null) {
    return (
      <div className="develop">
        <div className="empty">Select a photo in the Library first.</div>
      </div>
    );
  }

  const cursor =
    tool === "pickBase" ? "crosshair" : tool === "spot" ? "cell" : "default";

  return (
    <div className="develop">
      <div className="develop-main">
        <div className="preview-stage" ref={stageRef}>
          {preview && fit ? (
            <div
              className="preview-wrap"
              style={{ width: fit.w, height: fit.h, cursor }}
              onClick={(e) => void onImageClick(e)}
            >
              <img src={preview.dataUrl} alt="" draggable={false} />
              {tool === "spot" && (
                <svg className="spot-overlay" viewBox={`0 0 ${fit.w} ${fit.h}`}>
                  {recipe.spots.map((s, i) => (
                    <circle
                      key={i}
                      cx={s.x * fit.w}
                      cy={s.y * fit.h}
                      r={s.radius * fit.w}
                      className="spot-circle"
                    />
                  ))}
                </svg>
              )}
              {tool === "crop" && (
                <CropOverlay crop={recipe.crop} onChange={(c) => updateRecipe({ crop: c })} />
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
        <Panels histogram={preview?.histogram ?? null} />
      </aside>
    </div>
  );
}

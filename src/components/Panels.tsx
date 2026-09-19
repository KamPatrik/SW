import { useEffect, useState } from "react";
import * as api from "../api";
import { useStore } from "../store";
import type { ExifInfo, HistogramData } from "../types";
import CurveEditor from "./CurveEditor";
import Histogram from "./Histogram";
import Slider from "./Slider";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="panel" open>
      <summary>{title}</summary>
      <div className="panel-body">{children}</div>
    </details>
  );
}

function linearToSrgb(v: number): number {
  return Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255);
}

export default function Panels({ histogram }: { histogram: HistogramData | null }) {
  const recipe = useStore((s) => s.recipe);
  const updateRecipe = useStore((s) => s.updateRecipe);
  const updateNegative = useStore((s) => s.updateNegative);
  const resetRecipe = useStore((s) => s.resetRecipe);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const spotRadius = useStore((s) => s.spotRadius);
  const setSpotRadius = useStore((s) => s.setSpotRadius);
  const presets = useStore((s) => s.presets);
  const setGridVisible = useStore((s) => s.setGridVisible);
  const activeId = useStore((s) => s.activeId);
  const cropAspect = useStore((s) => s.cropAspect);
  const setCropAspect = useStore((s) => s.setCropAspect);
  const [presetName, setPresetName] = useState("");
  const [exif, setExif] = useState<ExifInfo | null>(null);

  useEffect(() => {
    void useStore.getState().refreshPresets();
  }, []);

  useEffect(() => {
    setExif(null);
    if (activeId !== null) {
      api.getExif(activeId).then(setExif).catch(() => setExif(null));
    }
  }, [activeId]);

  const savePreset = () => {
    const n = presetName.trim();
    if (!n) return;
    void useStore.getState().saveCurrentAsPreset(n);
    setPresetName("");
  };

  const autoTone = () => {
    if (!histogram) return;
    const bins = histogram.l;
    const total = bins.reduce((a, b) => a + b, 0);
    if (!total) return;
    const pct = (p: number) => {
      let acc = 0;
      for (let i = 0; i < bins.length; i++) {
        acc += bins[i];
        if (acc >= total * p) return i / (bins.length - 1);
      }
      return 1;
    };
    const p1 = pct(0.01);
    const p50 = pct(0.5);
    const p99 = pct(0.995);
    const medLin = Math.pow(Math.max(0.001, p50), 2.2);
    const expDelta = Math.max(-1.5, Math.min(1.5, Math.log2(0.18 / medLin) * 0.6));
    updateRecipe({
      exposure: Number(Math.max(-5, Math.min(5, recipe.exposure + expDelta)).toFixed(2)),
      whites: Math.round(Math.max(-100, Math.min(100, recipe.whites + (0.98 - p99) * 285))),
      blacks: Math.round(Math.max(-100, Math.min(100, recipe.blacks + (0.02 - p1) * 285))),
    });
  };

  const neg = recipe.negative;
  const baseSwatch = neg.filmBase
    ? `rgb(${linearToSrgb(neg.filmBase[0])}, ${linearToSrgb(neg.filmBase[1])}, ${linearToSrgb(neg.filmBase[2])})`
    : undefined;

  return (
    <div className="panels">
      <Histogram data={histogram} />

      <Section title="Presets">
        {presets.length === 0 && (
          <div className="hint">No presets yet — tune a photo, then save its look.</div>
        )}
        {presets.map((p) => (
          <div key={p.id} className="preset-row">
            <button
              className="preset-apply"
              title="Apply preset"
              onClick={() => void useStore.getState().applyPreset(p.id)}
            >
              {p.name}
            </button>
            <button
              className="preset-del"
              title="Delete preset"
              onClick={() => void useStore.getState().deletePreset(p.id)}
            >
              ×
            </button>
          </div>
        ))}
        <div className="row">
          <input
            className="preset-name"
            type="text"
            placeholder="Preset name…"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && savePreset()}
          />
          <button className="btn small" disabled={!presetName.trim()} onClick={savePreset}>
            Save
          </button>
        </div>
        <div className="hint">Stores tone, colour &amp; negative settings (not crop/spots)</div>
      </Section>

      <Section title="White balance">
        <div className="row">
          <button
            className={tool === "pickWb" ? "btn small on" : "btn small"}
            onClick={() => setTool("pickWb")}
            title="Click a neutral grey area in the image"
          >
            💧 Eyedropper
          </button>
        </div>
        <Slider label="Temp" value={recipe.wbTemp} min={-100} max={100} onChange={(v) => updateRecipe({ wbTemp: v })} />
        <Slider label="Tint" value={recipe.wbTint} min={-100} max={100} onChange={(v) => updateRecipe({ wbTint: v })} />
      </Section>

      <Section title="Tone">
        <div className="row">
          <button className="btn small" disabled={!histogram} onClick={autoTone} title="Auto exposure / whites / blacks">
            Auto
          </button>
        </div>
        <Slider
          label="Exposure"
          value={recipe.exposure}
          min={-5}
          max={5}
          step={0.05}
          onChange={(v) => updateRecipe({ exposure: v })}
          format={(v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) + " EV"}
        />
        <Slider label="Contrast" value={recipe.contrast} min={-100} max={100} onChange={(v) => updateRecipe({ contrast: v })} />
        <Slider label="Highlights" value={recipe.highlights} min={-100} max={100} onChange={(v) => updateRecipe({ highlights: v })} />
        <Slider label="Shadows" value={recipe.shadows} min={-100} max={100} onChange={(v) => updateRecipe({ shadows: v })} />
        <Slider label="Whites" value={recipe.whites} min={-100} max={100} onChange={(v) => updateRecipe({ whites: v })} />
        <Slider label="Blacks" value={recipe.blacks} min={-100} max={100} onChange={(v) => updateRecipe({ blacks: v })} />
      </Section>

      <Section title="Presence">
        <Slider label="Vibrance" value={recipe.vibrance} min={-100} max={100} onChange={(v) => updateRecipe({ vibrance: v })} />
        <Slider label="Saturation" value={recipe.saturation} min={-100} max={100} onChange={(v) => updateRecipe({ saturation: v })} />
        <Slider label="Clarity" value={recipe.clarity} min={-100} max={100} onChange={(v) => updateRecipe({ clarity: v })} />
        <Slider label="Sharpen" value={recipe.sharpen} min={0} max={100} onChange={(v) => updateRecipe({ sharpen: v })} />
        <Slider label="Noise reduction" value={recipe.noise} min={0} max={100} onChange={(v) => updateRecipe({ noise: v })} />
      </Section>

      <Section title="Effects">
        <Slider label="Vignette" value={recipe.vignette} min={-100} max={100} onChange={(v) => updateRecipe({ vignette: v })} />
        <Slider label="Grain" value={recipe.grain} min={0} max={100} onChange={(v) => updateRecipe({ grain: v })} />
      </Section>

      <Section title="Tone curve">
        <CurveEditor points={recipe.toneCurve} onChange={(pts) => updateRecipe({ toneCurve: pts })} />
        <div className="hint">Drag points · double-click to add / remove</div>
      </Section>

      <Section title="Film negative">
        <label className="checkrow">
          <input
            type="checkbox"
            checked={neg.enabled}
            onChange={(e) => updateNegative({ enabled: e.target.checked })}
          />
          Convert negative → positive
        </label>
        <div className="row">
          <button
            className={tool === "pickBase" ? "btn small on" : "btn small"}
            onClick={() => setTool("pickBase")}
            title="Click on unexposed film border / sprocket area in the image"
          >
            Pick film base
          </button>
          {baseSwatch ? (
            <>
              <span className="swatch" style={{ background: baseSwatch }} title="Sampled film base" />
              <button className="btn small" onClick={() => updateNegative({ filmBase: null })}>
                Auto
              </button>
            </>
          ) : (
            <span className="hint">base: auto</span>
          )}
        </div>
        <Slider
          label="Gamma"
          value={neg.gamma}
          min={0.4}
          max={1.6}
          step={0.01}
          defaultValue={1}
          onChange={(v) => updateNegative({ gamma: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider label="Red balance" value={neg.redBalance} min={-100} max={100} onChange={(v) => updateNegative({ redBalance: v })} />
        <Slider label="Blue balance" value={neg.blueBalance} min={-100} max={100} onChange={(v) => updateNegative({ blueBalance: v })} />
      </Section>

      <Section title="Dust removal">
        <div className="row">
          <button
            className={tool === "spot" ? "btn small on" : "btn small"}
            onClick={() => setTool("spot")}
          >
            {tool === "spot" ? "Spot tool: ON" : "Spot tool"}
          </button>
          <button
            className="btn small"
            disabled={recipe.spots.length === 0}
            onClick={() => updateRecipe({ spots: [] })}
          >
            Clear ({recipe.spots.length})
          </button>
        </div>
        <Slider
          label="Spot size"
          value={spotRadius * 1000}
          min={2}
          max={50}
          step={0.5}
          defaultValue={8}
          onChange={(v) => setSpotRadius(v / 1000)}
          format={(v) => (v / 10).toFixed(1) + "%"}
        />
        <div className="hint">Click to heal a spot · drag to heal a streak · click a mark to remove it</div>
      </Section>

      <Section title="Red eye">
        <div className="row">
          <button
            className={tool === "redeye" ? "btn small on" : "btn small"}
            onClick={() => setTool("redeye")}
          >
            {tool === "redeye" ? "Red eye: ON" : "Red eye tool"}
          </button>
          <button
            className="btn small"
            disabled={recipe.redeye.length === 0}
            onClick={() => updateRecipe({ redeye: [] })}
          >
            Clear ({recipe.redeye.length})
          </button>
        </div>
        <div className="hint">
          Click each red pupil · circle size follows Spot size · click a mark to remove
        </div>
      </Section>

      <Section title="Geometry">
        <div className="row">
          <button className="btn small" onClick={() => updateRecipe({ rotate90: (recipe.rotate90 + 3) % 4 })}>
            ⟲ 90°
          </button>
          <button className="btn small" onClick={() => updateRecipe({ rotate90: (recipe.rotate90 + 1) % 4 })}>
            ⟳ 90°
          </button>
          <button className={recipe.flipH ? "btn small on" : "btn small"} onClick={() => updateRecipe({ flipH: !recipe.flipH })}>
            Flip H
          </button>
          <button className={recipe.flipV ? "btn small on" : "btn small"} onClick={() => updateRecipe({ flipV: !recipe.flipV })}>
            Flip V
          </button>
        </div>
        <Slider
          label="Straighten"
          value={recipe.angle}
          min={-45}
          max={45}
          step={0.1}
          onChange={(v) => updateRecipe({ angle: v })}
          format={(v) => v.toFixed(1) + "°"}
          onDragChange={(d) => setGridVisible(d)}
        />
        <div className="row">
          <button className={tool === "crop" ? "btn small on" : "btn small"} onClick={() => setTool("crop")}>
            {tool === "crop" ? "Done cropping" : "Crop"}
          </button>
          <button className="btn small" disabled={!recipe.crop} onClick={() => updateRecipe({ crop: null })}>
            Reset crop
          </button>
        </div>
        <div className="row">
          <label className="aspect-label">Aspect</label>
          <select value={cropAspect} onChange={(e) => setCropAspect(e.target.value)}>
            <option value="free">Free</option>
            <option value="original">Original</option>
            <option value="1:1">1 : 1</option>
            <option value="3:2">3 : 2</option>
            <option value="2:3">2 : 3</option>
            <option value="4:3">4 : 3</option>
            <option value="3:4">3 : 4</option>
            <option value="16:9">16 : 9</option>
          </select>
        </div>
      </Section>

      <Section title="Info">
        {exif ? (
          <div className="exif">
            {exif.camera && <div className="exif-row"><span>Camera</span><span>{exif.camera}</span></div>}
            {exif.lens && <div className="exif-row"><span>Lens</span><span>{exif.lens}</span></div>}
            {exif.iso && <div className="exif-row"><span>ISO</span><span>{exif.iso}</span></div>}
            {exif.shutter && <div className="exif-row"><span>Shutter</span><span>{exif.shutter}</span></div>}
            {exif.aperture && <div className="exif-row"><span>Aperture</span><span>{exif.aperture}</span></div>}
            {exif.focal && <div className="exif-row"><span>Focal</span><span>{exif.focal}</span></div>}
            {exif.captured && <div className="exif-row"><span>Captured</span><span>{exif.captured}</span></div>}
            {exif.fileSize != null && (
              <div className="exif-row"><span>File</span><span>{(exif.fileSize / 1048576).toFixed(1)} MB</span></div>
            )}
          </div>
        ) : (
          <div className="hint">No metadata</div>
        )}
      </Section>

      <button className="btn danger reset-all" onClick={() => resetRecipe()}>
        Reset all edits
      </button>
    </div>
  );
}

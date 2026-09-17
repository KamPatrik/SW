import { useStore } from "../store";
import type { HistogramData } from "../types";
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

  const neg = recipe.negative;
  const baseSwatch = neg.filmBase
    ? `rgb(${linearToSrgb(neg.filmBase[0])}, ${linearToSrgb(neg.filmBase[1])}, ${linearToSrgb(neg.filmBase[2])})`
    : undefined;

  return (
    <div className="panels">
      <Histogram data={histogram} />

      <Section title="White balance">
        <Slider label="Temp" value={recipe.wbTemp} min={-100} max={100} onChange={(v) => updateRecipe({ wbTemp: v })} />
        <Slider label="Tint" value={recipe.wbTint} min={-100} max={100} onChange={(v) => updateRecipe({ wbTint: v })} />
      </Section>

      <Section title="Tone">
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
        <Slider label="Sharpen" value={recipe.sharpen} min={0} max={100} onChange={(v) => updateRecipe({ sharpen: v })} />
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
        <div className="hint">Click a dust spot to heal it · click again to remove</div>
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
        />
        <div className="row">
          <button className={tool === "crop" ? "btn small on" : "btn small"} onClick={() => setTool("crop")}>
            {tool === "crop" ? "Done cropping" : "Crop"}
          </button>
          <button className="btn small" disabled={!recipe.crop} onClick={() => updateRecipe({ crop: null })}>
            Reset crop
          </button>
        </div>
      </Section>

      <button className="btn danger reset-all" onClick={() => resetRecipe()}>
        Reset all edits
      </button>
    </div>
  );
}

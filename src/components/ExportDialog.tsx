import { useState } from "react";
import * as api from "../api";
import { useStore } from "../store";

export default function ExportDialog() {
  const setExportOpen = useStore((s) => s.setExportOpen);
  const selection = useStore((s) => s.selection);
  const activeId = useStore((s) => s.activeId);
  const photos = useStore((s) => s.photos);

  const ids = selection.length > 0 ? selection : activeId !== null ? [activeId] : [];

  const [dest, setDest] = useState("");
  const [format, setFormat] = useState<"jpeg" | "png">("jpeg");
  const [quality, setQuality] = useState(90);
  const [maxSize, setMaxSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const pickDest = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Export destination" });
    if (typeof dir === "string") setDest(dir);
  };

  const run = async () => {
    if (!dest || ids.length === 0) return;
    setBusy(true);
    setLog([]);
    const max = maxSize.trim() === "" ? undefined : Math.max(256, Number(maxSize) || 0) || undefined;
    for (const id of ids) {
      const name = photos.find((p) => p.id === id)?.filename ?? String(id);
      try {
        const out = await api.exportPhoto(id, dest, format, quality, max);
        setLog((l) => [...l, `✓ ${name} → ${out}`]);
      } catch (e) {
        setLog((l) => [...l, `✗ ${name}: ${String(e)}`]);
      }
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && setExportOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export {ids.length} photo{ids.length === 1 ? "" : "s"}</h2>

        <div className="form-row">
          <label>Destination</label>
          <div className="row grow">
            <input type="text" value={dest} readOnly placeholder="Choose a folder…" />
            <button className="btn small" onClick={() => void pickDest()}>
              Browse
            </button>
          </div>
        </div>

        <div className="form-row">
          <label>Format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value as "jpeg" | "png")}>
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
          </select>
        </div>

        {format === "jpeg" && (
          <div className="form-row">
            <label>Quality {quality}</label>
            <input
              type="range"
              min={50}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
            />
          </div>
        )}

        <div className="form-row">
          <label>Max size (px)</label>
          <input
            type="text"
            value={maxSize}
            onChange={(e) => setMaxSize(e.target.value)}
            placeholder="full resolution"
          />
        </div>

        {log.length > 0 && (
          <div className="export-log">
            {log.map((l, i) => (
              <div key={i} className={l.startsWith("✓") ? "ok" : "err"}>
                {l}
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={() => setExportOpen(false)} disabled={busy}>
            Close
          </button>
          <button className="btn primary" onClick={() => void run()} disabled={busy || !dest || ids.length === 0}>
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

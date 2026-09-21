import { useState } from "react";
import * as api from "../api";
import { useStore } from "../store";
import type { ExportOptions } from "../types";

const DEFAULTS: ExportOptions = {
  format: "jpeg",
  quality: 90,
  resizeMode: "none",
  resizePx: 2048,
  noEnlarge: true,
  namePattern: "{name}-revela",
  seq: 1,
  onConflict: "unique",
};

function loadSettings(): ExportOptions & { dest: string; openAfter: boolean } {
  try {
    const raw = localStorage.getItem("revela.export");
    if (raw) return { ...DEFAULTS, dest: "", openAfter: true, ...JSON.parse(raw) };
  } catch {
    // corrupted settings fall back to defaults
  }
  return { ...DEFAULTS, dest: "", openAfter: true };
}

export default function ExportDialog() {
  const setExportOpen = useStore((s) => s.setExportOpen);
  const selection = useStore((s) => s.selection);
  const activeId = useStore((s) => s.activeId);
  const photos = useStore((s) => s.photos);

  const ids = selection.length > 0 ? selection : activeId !== null ? [activeId] : [];

  const initial = loadSettings();
  const [dest, setDest] = useState(initial.dest);
  const [format, setFormat] = useState(initial.format);
  const [quality, setQuality] = useState(initial.quality);
  const [resizeMode, setResizeMode] = useState(initial.resizeMode);
  const [resizePx, setResizePx] = useState(String(initial.resizePx));
  const [noEnlarge, setNoEnlarge] = useState(initial.noEnlarge);
  const [namePattern, setNamePattern] = useState(initial.namePattern);
  const [seqStart, setSeqStart] = useState("1");
  const [onConflict, setOnConflict] = useState(initial.onConflict);
  const [openAfter, setOpenAfter] = useState(initial.openAfter);
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
    const px = Math.max(16, Number(resizePx) || 0);
    const opts: ExportOptions = {
      format,
      quality,
      resizeMode: resizeMode === "none" || px === 0 ? "none" : resizeMode,
      resizePx: px,
      noEnlarge,
      namePattern: namePattern.trim() || "{name}",
      seq: Math.max(1, Number(seqStart) || 1),
      onConflict,
    };
    localStorage.setItem("revela.export", JSON.stringify({ ...opts, dest, openAfter, seq: 1 }));
    let seq = opts.seq;
    for (const id of ids) {
      const name = photos.find((p) => p.id === id)?.filename ?? String(id);
      try {
        const out = await api.exportPhoto(id, dest, { ...opts, seq });
        if (out.skipped) {
          setLog((l) => [...l, `− ${name}: already exists, skipped`]);
        } else {
          setLog((l) => [...l, `✓ ${name} → ${out.path}`]);
          seq += 1;
        }
      } catch (e) {
        setLog((l) => [...l, `✗ ${name}: ${String(e)}`]);
      }
    }
    setBusy(false);
    if (openAfter) void api.openInExplorer(dest).catch(() => {});
  };

  const hasSeq = namePattern.includes("{seq}");

  return (
    <div className="modal-backdrop" onClick={() => !busy && setExportOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          Export {ids.length} photo{ids.length === 1 ? "" : "s"}
        </h2>

        <div className="form-row">
          <label>Destination</label>
          <div className="row grow">
            <input type="text" value={dest} readOnly placeholder="Choose a folder…" />
            <button className="btn small" onClick={() => void pickDest()}>
              Browse
            </button>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="tiff">TIFF (8-bit)</option>
              <option value="tiff16">TIFF (16-bit)</option>
            </select>
          </div>
          <div className="form-row">
            <label>If file exists</label>
            <select value={onConflict} onChange={(e) => setOnConflict(e.target.value)}>
              <option value="unique">Add number</option>
              <option value="overwrite">Overwrite</option>
              <option value="skip">Skip</option>
            </select>
          </div>
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

        <div className="form-grid">
          <div className="form-row">
            <label>Resize</label>
            <select value={resizeMode} onChange={(e) => setResizeMode(e.target.value)}>
              <option value="none">Original size</option>
              <option value="long">Long edge</option>
              <option value="short">Short edge</option>
              <option value="width">Width</option>
              <option value="height">Height</option>
            </select>
          </div>
          {resizeMode !== "none" && (
            <div className="form-row">
              <label>Pixels</label>
              <input
                type="text"
                value={resizePx}
                onChange={(e) => setResizePx(e.target.value)}
                placeholder="2048"
              />
            </div>
          )}
        </div>
        {resizeMode !== "none" && (
          <label className="checkrow">
            <input
              type="checkbox"
              checked={noEnlarge}
              onChange={(e) => setNoEnlarge(e.target.checked)}
            />
            Don't enlarge smaller photos
          </label>
        )}

        <div className="form-row">
          <label>File naming</label>
          <div className="row grow">
            <input
              type="text"
              value={namePattern}
              onChange={(e) => setNamePattern(e.target.value)}
              placeholder="{name}-revela"
            />
            {hasSeq && (
              <input
                className="seq-start"
                type="text"
                value={seqStart}
                onChange={(e) => setSeqStart(e.target.value)}
                title="Sequence start"
              />
            )}
          </div>
          <div className="hint">
            Tokens: {"{name}"} = original name · {"{seq}"} = number (001, 002…)
          </div>
        </div>

        <label className="checkrow">
          <input
            type="checkbox"
            checked={openAfter}
            onChange={(e) => setOpenAfter(e.target.checked)}
          />
          Open folder when done
        </label>

        {log.length > 0 && (
          <div className="export-log">
            {log.map((l, i) => (
              <div key={i} className={l.startsWith("✓") ? "ok" : l.startsWith("−") ? "" : "err"}>
                {l}
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={() => setExportOpen(false)} disabled={busy}>
            Close
          </button>
          <button
            className="btn primary"
            onClick={() => void run()}
            disabled={busy || !dest || ids.length === 0}
          >
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { filteredPhotos, useStore } from "../store";
import type { Photo } from "../types";

export const LABEL_COLORS: Record<string, string> = {
  red: "#d05c50",
  yellow: "#d0b050",
  green: "#5fae62",
  blue: "#5b83c9",
};

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={n <= value ? "star on" : "star"}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.(n === value ? 0 : n);
          }}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function Thumb({ photo }: { photo: Photo }) {
  const url = useStore((s) => s.thumbs[photo.id]);
  const isActive = useStore((s) => s.activeId === photo.id);
  const isSelected = useStore((s) => s.selection.includes(photo.id));
  const cardRef = useRef<HTMLDivElement>(null);

  // request the thumbnail only once the card becomes visible
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          useStore.getState().requestThumb(photo.id);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [photo.id]);

  const onClick = (e: React.MouseEvent) => {
    const s = useStore.getState();
    if (e.ctrlKey || e.metaKey) s.toggleSelect(photo.id);
    else if (e.shiftKey) s.rangeSelect(photo.id);
    else s.setActive(photo.id);
  };

  return (
    <div
      ref={cardRef}
      className={
        "card" + (isActive ? " active" : "") + (!isActive && isSelected ? " selected" : "")
      }
      onClick={onClick}
      onDoubleClick={() => void useStore.getState().openDevelop(photo.id)}
    >
      <div className="card-img">
        {url ? <img src={url} alt={photo.filename} draggable={false} /> : <div className="card-loading">…</div>}
        {photo.flag === 1 && <span className="badge pick">⚑</span>}
        {photo.flag === 2 && <span className="badge reject">✕</span>}
        {photo.hasEdits && <span className="badge edited">✎</span>}
        {photo.isRaw && <span className="badge raw">RAW</span>}
        {photo.dupGroup !== null && (
          <span
            className={photo.dupBest ? "badge dup best" : "badge dup"}
            title={photo.dupBest ? "Best of duplicate group" : `Duplicate group ${photo.dupGroup}`}
          >
            {photo.dupBest ? "★ best" : `◈ ${photo.dupGroup}`}
          </span>
        )}
        <span
          className="card-actions"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button
            className={photo.flag === 1 ? "flagbtn on" : "flagbtn"}
            title="Pick (P)"
            onClick={() => void useStore.getState().setFlag([photo.id], photo.flag === 1 ? 0 : 1)}
          >
            ⚑
          </button>
          <button
            className={photo.flag === 2 ? "flagbtn on reject" : "flagbtn reject"}
            title="Reject (X)"
            onClick={() => void useStore.getState().setFlag([photo.id], photo.flag === 2 ? 0 : 2)}
          >
            ✕
          </button>
        </span>
      </div>
      <div className="card-foot">
        {photo.colorLabel && LABEL_COLORS[photo.colorLabel] && (
          <span className="label-dot" style={{ background: LABEL_COLORS[photo.colorLabel] }} />
        )}
        <span className="card-name" title={photo.path}>
          {photo.filename}
        </span>
        <Stars
          value={photo.rating}
          onChange={(n) => void useStore.getState().setRating([photo.id], n)}
        />
      </div>
    </div>
  );
}

function TagEditor() {
  const active = useStore((s) =>
    s.activeId === null ? null : s.photos.find((p) => p.id === s.activeId) ?? null,
  );
  const [val, setVal] = useState("");
  if (!active) return null;
  const add = () => {
    const v = val.trim();
    if (!v) return;
    if (!active.tags.includes(v)) {
      void useStore.getState().setTags(active.id, [...active.tags, v]);
    }
    setVal("");
  };
  return (
    <div className="tag-editor">
      <div className="sidebar-title">Tags</div>
      <div className="tag-chips">
        {active.tags.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button
              title="Remove tag"
              onClick={() =>
                void useStore.getState().setTags(
                  active.id,
                  active.tags.filter((x) => x !== t),
                )
              }
            >
              ×
            </button>
          </span>
        ))}
        {active.tags.length === 0 && <span className="hint">no tags</span>}
      </div>
      <input
        type="text"
        value={val}
        placeholder="Add tag ↵"
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
    </div>
  );
}

export default function LibraryView() {
  const folders = useStore((s) => s.folders);
  const activeFolderId = useStore((s) => s.activeFolderId);
  const selectFolder = useStore((s) => s.selectFolder);
  const removeFolder = useStore((s) => s.removeFolder);
  const filterRating = useStore((s) => s.filterRating);
  const filterFlag = useStore((s) => s.filterFlag);
  const setFilterRating = useStore((s) => s.setFilterRating);
  const setFilterFlag = useStore((s) => s.setFilterFlag);
  const filterLabel = useStore((s) => s.filterLabel);
  const setFilterLabel = useStore((s) => s.setFilterLabel);
  const filterTag = useStore((s) => s.filterTag);
  const setFilterTag = useStore((s) => s.setFilterTag);
  const filterText = useStore((s) => s.filterText);
  const setFilterText = useStore((s) => s.setFilterText);
  const sortBy = useStore((s) => s.sortBy);
  const setSortBy = useStore((s) => s.setSortBy);
  const sortDir = useStore((s) => s.sortDir);
  const toggleSortDir = useStore((s) => s.toggleSortDir);
  const allPhotos = useStore((s) => s.photos);
  const allTags = useMemo(
    () => Array.from(new Set(allPhotos.flatMap((p) => p.tags))).sort(),
    [allPhotos],
  );
  const filterDups = useStore((s) => s.filterDups);
  const setFilterDups = useStore((s) => s.setFilterDups);
  const dupScan = useStore((s) => s.dupScan);
  const dupSummary = useStore((s) => s.dupSummary);
  const anyDups = useStore((s) => s.photos.some((p) => p.dupGroup !== null));
  const [dupStrict, setDupStrict] = useState("normal");
  const thumbSize = useStore((s) => s.thumbSize);
  const setThumbSize = useStore((s) => s.setThumbSize);
  const thumbFit = useStore((s) => s.thumbFit);
  const setThumbFit = useStore((s) => s.setThumbFit);
  // useShallow is required: a plain array-returning selector would create a new
  // reference on every snapshot and send React into an infinite render loop.
  const photos = useStore(useShallow(filteredPhotos));
  const total = useStore((s) => s.photos.length);

  return (
    <div className="library">
      <aside className="sidebar">
        <div className="sidebar-title">Folders</div>
        <div
          className={activeFolderId === null ? "folder active" : "folder"}
          onClick={() => void selectFolder(null)}
        >
          All photos
        </div>
        {folders.map((f) => (
          <div
            key={f.id}
            className={activeFolderId === f.id ? "folder active" : "folder"}
            onClick={() => void selectFolder(f.id)}
            title={f.path}
          >
            <span className="folder-name">{folderName(f.path)}</span>
            <button
              className="folder-remove"
              title="Remove from catalog (files stay on disk)"
              onClick={(e) => {
                e.stopPropagation();
                void removeFolder(f.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        {folders.length === 0 && (
          <div className="sidebar-hint">Import a folder to get started.</div>
        )}
        <TagEditor />
      </aside>
      <main className="library-main">
        <div className="filterbar">
          <span className="filter-label">Filter</span>
          <Stars value={filterRating} onChange={(n) => setFilterRating(n)} />
          <div className="flag-filters">
            <button className={filterFlag === null ? "chip on" : "chip"} onClick={() => setFilterFlag(null)}>
              All
            </button>
            <button className={filterFlag === 1 ? "chip on" : "chip"} onClick={() => setFilterFlag(filterFlag === 1 ? null : 1)}>
              ⚑ Picked
            </button>
            <button className={filterFlag === 2 ? "chip on" : "chip"} onClick={() => setFilterFlag(filterFlag === 2 ? null : 2)}>
              ✕ Rejected
            </button>
          </div>
          <span className="label-filters">
            {Object.entries(LABEL_COLORS).map(([name, color]) => (
              <button
                key={name}
                className={filterLabel === name ? "label-dot-btn on" : "label-dot-btn"}
                style={{ background: color }}
                title={`Label: ${name} (${{ red: 6, yellow: 7, green: 8, blue: 9 }[name]})`}
                onClick={() => setFilterLabel(filterLabel === name ? null : name)}
              />
            ))}
          </span>
          {allTags.length > 0 && (
            <select
              className="tag-filter"
              value={filterTag ?? ""}
              onChange={(e) => setFilterTag(e.target.value === "" ? null : e.target.value)}
            >
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <input
            className="search"
            type="text"
            placeholder="Search…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "captured" | "name" | "rating")}
            title="Sort by"
          >
            <option value="captured">Date</option>
            <option value="name">Name</option>
            <option value="rating">Rating</option>
          </select>
          <button className="chip" onClick={toggleSortDir} title="Sort direction">
            {sortDir === 1 ? "↑" : "↓"}
          </button>
          <span className="dup-controls">
            <select
              value={dupStrict}
              onChange={(e) => setDupStrict(e.target.value)}
              title="Duplicate matching strictness"
            >
              <option value="strict">Strict</option>
              <option value="normal">Normal</option>
              <option value="loose">Loose</option>
            </select>
            <button
              className="btn small"
              disabled={dupScan !== null || total === 0}
              onClick={() => void useStore.getState().findDuplicates(dupStrict)}
              title="Scan the current view for visually near-identical photos"
            >
              {dupScan ? `Scanning ${dupScan.done}/${dupScan.total}…` : "Find duplicates"}
            </button>
            {(anyDups || dupSummary) && (
              <>
                <button
                  className={filterDups ? "chip on" : "chip"}
                  onClick={() => setFilterDups(!filterDups)}
                >
                  ◈ Duplicates{dupSummary ? ` · ${dupSummary}` : ""}
                </button>
                {filterDups && anyDups && (
                  <button
                    className="btn small"
                    title="Flag every non-best duplicate as rejected"
                    onClick={() => void useStore.getState().rejectNonBest()}
                  >
                    ✕ Reject non-best
                  </button>
                )}
                {anyDups && (
                  <button
                    className="btn small"
                    title="Forget duplicate groups in this view"
                    onClick={() => void useStore.getState().clearDuplicates()}
                  >
                    Clear
                  </button>
                )}
              </>
            )}
          </span>
          <span className="size-ctl">
            <button
              className={thumbFit === "contain" ? "chip on" : "chip"}
              title="Show the whole photo in each cell"
              onClick={() => setThumbFit("contain")}
            >
              Fit
            </button>
            <button
              className={thumbFit === "cover" ? "chip on" : "chip"}
              title="Fill the square cell (crops the preview)"
              onClick={() => setThumbFit("cover")}
            >
              Fill
            </button>
            <input
              type="range"
              min={110}
              max={340}
              step={10}
              value={thumbSize}
              title="Thumbnail size (+/-)"
              onChange={(e) => setThumbSize(Number(e.target.value))}
            />
          </span>
          <span className="filter-count">
            {photos.length} / {total}
          </span>
        </div>
        {photos.length === 0 ? (
          <div className="empty">
            <p>No photos here yet.</p>
            <p className="empty-hint">
              Use <b>Import folder</b> to add RAW files, scans or JPEGs. Rate with{" "}
              <kbd>1–5</kbd>, flag with <kbd>P</kbd>/<kbd>X</kbd>, colour labels{" "}
              <kbd>6–9</kbd>, open Develop with <kbd>D</kbd>. <kbd>Del</kbd> removes from
              catalog, <kbd>Ctrl+Shift+C/V</kbd> copies &amp; pastes settings.
            </p>
          </div>
        ) : (
          <div
            className={
              "grid" +
              (thumbSize < 150 ? " compact" : "") +
              (thumbFit === "cover" ? " cover" : "")
            }
            style={{ "--thumb": `${thumbSize}px` } as React.CSSProperties}
          >
            {photos.map((p) => (
              <Thumb key={p.id} photo={p} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

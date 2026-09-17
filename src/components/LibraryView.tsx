import { useEffect } from "react";
import { filteredPhotos, useStore } from "../store";
import type { Photo } from "../types";

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

  useEffect(() => {
    useStore.getState().requestThumb(photo.id);
  }, [photo.id]);

  const onClick = (e: React.MouseEvent) => {
    const s = useStore.getState();
    if (e.ctrlKey || e.metaKey) s.toggleSelect(photo.id);
    else if (e.shiftKey) s.rangeSelect(photo.id);
    else s.setActive(photo.id);
  };

  return (
    <div
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
      </div>
      <div className="card-foot">
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

export default function LibraryView() {
  const folders = useStore((s) => s.folders);
  const activeFolderId = useStore((s) => s.activeFolderId);
  const selectFolder = useStore((s) => s.selectFolder);
  const removeFolder = useStore((s) => s.removeFolder);
  const filterRating = useStore((s) => s.filterRating);
  const filterFlag = useStore((s) => s.filterFlag);
  const setFilterRating = useStore((s) => s.setFilterRating);
  const setFilterFlag = useStore((s) => s.setFilterFlag);
  const photos = useStore(filteredPhotos);
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
          <span className="filter-count">
            {photos.length} / {total}
          </span>
        </div>
        {photos.length === 0 ? (
          <div className="empty">
            <p>No photos here yet.</p>
            <p className="empty-hint">
              Use <b>Import folder</b> to add RAW files, scans or JPEGs. Rate with{" "}
              <kbd>1–5</kbd>, flag with <kbd>P</kbd>/<kbd>X</kbd>, open Develop with{" "}
              <kbd>D</kbd>.
            </p>
          </div>
        ) : (
          <div className="grid">
            {photos.map((p) => (
              <Thumb key={p.id} photo={p} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

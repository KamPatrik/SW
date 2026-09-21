import { useEffect } from "react";
import { sendViewerState } from "./secondWindow";
import { useStore } from "./store";
import TopBar from "./components/TopBar";
import LibraryView from "./components/LibraryView";
import DevelopView from "./components/DevelopView";
import ExportDialog from "./components/ExportDialog";

export default function App() {
  const view = useStore((s) => s.view);
  const exportOpen = useStore((s) => s.exportOpen);

  useEffect(() => {
    void useStore.getState().refreshFolders();
    void useStore.getState().refreshPhotos();
  }, []);

  // keep the second window in sync with the active photo & live edits
  useEffect(() => {
    let un: (() => void) | undefined;
    let unThumbs: (() => void) | undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      un = await listen("viewer-ready", () => void sendViewerState());
      unThumbs = await listen<{ done: number; total: number }>("thumbs-progress", (e) => {
        useStore
          .getState()
          .setThumbsProgress(e.payload.done >= e.payload.total ? null : e.payload);
      });
    })();
    const unsub = useStore.subscribe((state, prev) => {
      if (state.activeId !== prev.activeId || state.recipe !== prev.recipe) {
        if (t) clearTimeout(t);
        t = setTimeout(() => void sendViewerState(), 150);
      }
    });
    return () => {
      if (t) clearTimeout(t);
      un?.();
      unThumbs?.();
      unsub();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
      const s = useStore.getState();
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" || e.key === "Z") {
          s.undo();
          e.preventDefault();
        } else if (e.shiftKey && (e.key === "c" || e.key === "C")) {
          s.copySettings();
          e.preventDefault();
        } else if (e.shiftKey && (e.key === "v" || e.key === "V")) {
          void s.pasteSettings();
          e.preventDefault();
        }
        return;
      }
      if (e.key === "\\") {
        if (s.view === "develop") s.setShowBefore(true);
        e.preventDefault();
        return;
      }
      const targets = s.selection.length > 0 ? s.selection : s.activeId !== null ? [s.activeId] : [];
      const labels: Record<string, string> = { "6": "red", "7": "yellow", "8": "green", "9": "blue" };
      if (labels[e.key] && targets.length) {
        const cur = s.photos.find((p) => p.id === targets[0])?.colorLabel ?? null;
        const next = cur === labels[e.key] ? null : labels[e.key];
        void s.setColorLabel(targets, next);
        return;
      }
      if (e.key === "Delete" && s.view === "library" && targets.length) {
        if (confirm(`Remove ${targets.length} photo(s) from the catalog? Files stay on disk.`)) {
          void s.removePhotos(targets);
        }
        return;
      }
      if (s.view === "library" && (e.key === "+" || e.key === "=" || e.key === "-")) {
        s.setThumbSize(s.thumbSize + (e.key === "-" ? -20 : 20));
        return;
      }
      switch (e.key) {
        case "g":
        case "G":
          s.setView("library");
          break;
        case "d":
        case "D":
          if (s.activeId !== null) void s.openDevelop(s.activeId);
          break;
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
          if (targets.length) void s.setRating(targets, Number(e.key));
          break;
        case "p":
        case "P":
          if (targets.length) void s.setFlag(targets, 1);
          break;
        case "x":
        case "X":
          if (targets.length) void s.setFlag(targets, 2);
          break;
        case "u":
        case "U":
          if (targets.length) void s.setFlag(targets, 0);
          break;
        case "ArrowRight":
          s.navigate(1);
          e.preventDefault();
          break;
        case "ArrowLeft":
          s.navigate(-1);
          e.preventDefault();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "\\") useStore.getState().setShowBefore(false);
    };
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return (
    <div className="app-shell">
      <TopBar />
      {view === "library" ? <LibraryView /> : <DevelopView />}
      {exportOpen && <ExportDialog />}
    </div>
  );
}

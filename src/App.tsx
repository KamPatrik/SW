import { useEffect } from "react";
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
      const s = useStore.getState();
      const targets = s.selection.length > 0 ? s.selection : s.activeId !== null ? [s.activeId] : [];
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
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-shell">
      <TopBar />
      {view === "library" ? <LibraryView /> : <DevelopView />}
      {exportOpen && <ExportDialog />}
    </div>
  );
}

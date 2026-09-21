import { toggleSecondWindow } from "../secondWindow";
import { useStore } from "../store";

export default function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const activeId = useStore((s) => s.activeId);
  const openDevelop = useStore((s) => s.openDevelop);
  const setExportOpen = useStore((s) => s.setExportOpen);
  const importing = useStore((s) => s.importing);
  const importFolder = useStore((s) => s.importFolder);
  const thumbsProgress = useStore((s) => s.thumbsProgress);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        Revela
      </div>
      <nav className="topnav">
        <button className={view === "library" ? "navbtn active" : "navbtn"} onClick={() => setView("library")}>
          Library <kbd>G</kbd>
        </button>
        <button
          className={view === "develop" ? "navbtn active" : "navbtn"}
          disabled={activeId === null}
          onClick={() => activeId !== null && void openDevelop(activeId)}
        >
          Develop <kbd>D</kbd>
        </button>
      </nav>
      <div className="topbar-right">
        {thumbsProgress && (
          <span className="thumbs-progress" title="Generating previews in the background">
            previews {thumbsProgress.done}/{thumbsProgress.total}
          </span>
        )}
        <button
          className="btn"
          title="Show the photo big on a second window — lands on your other monitor when one is connected"
          onClick={() => void toggleSecondWindow()}
        >
          ⧉ 2nd screen
        </button>
        <button className="btn" onClick={() => void importFolder()} disabled={importing}>
          {importing ? "Importing…" : "Import folder"}
        </button>
        <button className="btn" disabled={activeId === null} onClick={() => setExportOpen(true)}>
          Export
        </button>
      </div>
    </header>
  );
}

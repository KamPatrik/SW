import * as api from "./api";
import { useStore } from "./store";
import { cloneRecipe, DEFAULT_RECIPE, type Recipe } from "./types";

const LABEL = "viewer";

// Open (or close, when already open) the big-photo window. If a second
// monitor is detected, the window is placed and maximized there.
export async function toggleSecondWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(LABEL);
  if (existing) {
    await existing.close();
    return;
  }

  let opts: Record<string, unknown> = { width: 1100, height: 800, center: true };
  let onSecondMonitor = false;
  try {
    const { getCurrentWindow, availableMonitors } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const [pos, size, monitors] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      availableMonitors(),
    ]);
    const cx = pos.x + size.width / 2;
    const cy = pos.y + size.height / 2;
    const other = monitors.find(
      (m) =>
        !(
          cx >= m.position.x &&
          cx < m.position.x + m.size.width &&
          cy >= m.position.y &&
          cy < m.position.y + m.size.height
        ),
    );
    if (other) {
      // window options take logical pixels; monitor info is physical
      const sf = other.scaleFactor || 1;
      opts = {
        x: (other.position.x + 40) / sf,
        y: (other.position.y + 40) / sf,
        width: Math.min(1400, (other.size.width / sf) * 0.9),
        height: Math.min(1000, (other.size.height / sf) * 0.9),
      };
      onSecondMonitor = true;
    }
  } catch {
    // monitor probing is best effort — fall back to a centered window
  }

  const viewer = new WebviewWindow(LABEL, {
    url: "index.html#viewer",
    title: "Revela — Second window",
    ...opts,
  });
  void viewer.once("tauri://created", () => {
    if (onSecondMonitor) void viewer.maximize();
    void sendViewerState();
  });
}

// Push the active photo + its current recipe to the viewer window (no-op
// when the window is closed). The viewer renders independently.
export async function sendViewerState(): Promise<void> {
  const s = useStore.getState();
  if (s.activeId === null) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const viewer = await WebviewWindow.getByLabel(LABEL);
  if (!viewer) return;
  const photo = s.photos.find((p) => p.id === s.activeId);
  const recipe: Recipe =
    s.recipeFor === s.activeId
      ? s.recipe
      : ((await api.getEdits(s.activeId)) ?? cloneRecipe(DEFAULT_RECIPE));
  const { emit } = await import("@tauri-apps/api/event");
  await emit("viewer-photo", {
    photoId: s.activeId,
    recipe,
    filename: photo?.filename ?? "",
  });
}

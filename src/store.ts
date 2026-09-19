import { create } from "zustand";
import * as api from "./api";
import {
  cloneRecipe,
  DEFAULT_RECIPE,
  type Folder,
  type NegativeParams,
  type Photo,
  type Preset,
  type Recipe,
  type Tool,
} from "./types";

interface AppStore {
  view: "library" | "develop";
  folders: Folder[];
  photos: Photo[];
  activeFolderId: number | null;
  activeId: number | null;
  selection: number[];
  filterRating: number;
  filterFlag: number | null;
  thumbs: Record<number, string>;
  recipe: Recipe;
  recipeFor: number | null;
  tool: Tool;
  spotRadius: number;
  exportOpen: boolean;
  importing: boolean;
  presets: Preset[];
  gridVisible: boolean;
  history: Recipe[];
  settingsClipboard: Recipe | null;
  showBefore: boolean;
  filterLabel: string | null;
  filterTag: string | null;
  filterText: string;
  sortBy: "captured" | "name" | "rating";
  sortDir: 1 | -1;
  cropAspect: string;
  filterDups: boolean;
  dupScan: { done: number; total: number } | null;
  dupSummary: string | null;

  setView(v: "library" | "develop"): void;
  refreshFolders(): Promise<void>;
  refreshPhotos(): Promise<void>;
  selectFolder(id: number | null): Promise<void>;
  importFolder(): Promise<void>;
  removeFolder(id: number): Promise<void>;
  requestThumb(id: number): void;
  setActive(id: number | null): void;
  toggleSelect(id: number): void;
  rangeSelect(id: number): void;
  setRating(ids: number[], rating: number): Promise<void>;
  setFlag(ids: number[], flag: number): Promise<void>;
  setTags(id: number, tags: string[]): Promise<void>;
  openDevelop(id: number): Promise<void>;
  loadRecipeFor(id: number): Promise<void>;
  updateRecipe(patch: Partial<Recipe>): void;
  updateNegative(patch: Partial<NegativeParams>): void;
  resetRecipe(): void;
  undo(): void;
  setTool(t: Tool): void;
  setSpotRadius(r: number): void;
  setExportOpen(open: boolean): void;
  navigate(dir: 1 | -1): void;
  setFilterRating(n: number): void;
  setFilterFlag(f: number | null): void;
  setGridVisible(v: boolean): void;
  refreshPresets(): Promise<void>;
  saveCurrentAsPreset(name: string): Promise<void>;
  applyPreset(id: number): Promise<void>;
  deletePreset(id: number): Promise<void>;
  renameActive(newStem: string): Promise<void>;
  copySettings(): void;
  pasteSettings(): Promise<void>;
  setShowBefore(v: boolean): void;
  setColorLabel(ids: number[], label: string | null): Promise<void>;
  removePhotos(ids: number[]): Promise<void>;
  setFilterLabel(l: string | null): void;
  setFilterTag(t: string | null): void;
  setFilterText(t: string): void;
  setSortBy(s: "captured" | "name" | "rating"): void;
  toggleSortDir(): void;
  setCropAspect(a: string): void;
  findDuplicates(strictness: string): Promise<void>;
  clearDuplicates(): Promise<void>;
  setFilterDups(v: boolean): void;
  rejectNonBest(): Promise<void>;
}

export function filteredPhotos(s: {
  photos: Photo[];
  filterRating: number;
  filterFlag: number | null;
  filterLabel: string | null;
  filterTag: string | null;
  filterText: string;
  sortBy: "captured" | "name" | "rating";
  sortDir: 1 | -1;
  filterDups: boolean;
}): Photo[] {
  const q = s.filterText.trim().toLowerCase();
  const arr = s.photos.filter(
    (p) =>
      p.rating >= s.filterRating &&
      (s.filterFlag === null || p.flag === s.filterFlag) &&
      (s.filterLabel === null || p.colorLabel === s.filterLabel) &&
      (s.filterTag === null || p.tags.includes(s.filterTag)) &&
      (q === "" || p.filename.toLowerCase().includes(q)) &&
      (!s.filterDups || p.dupGroup !== null),
  );
  if (s.filterDups) {
    // duplicates view: keep groups together, best frame first
    arr.sort(
      (a, b) =>
        (a.dupGroup ?? 0) - (b.dupGroup ?? 0) ||
        Number(b.dupBest) - Number(a.dupBest) ||
        a.id - b.id,
    );
    return arr;
  }
  arr.sort((a, b) => {
    let c = 0;
    if (s.sortBy === "name") c = a.filename.localeCompare(b.filename);
    else if (s.sortBy === "rating") c = a.rating - b.rating;
    else c = (a.capturedAt ?? "").localeCompare(b.capturedAt ?? "");
    return c * s.sortDir || a.id - b.id;
  });
  return arr;
}

// fields that stay per-photo when copying settings or applying presets
function stripPhotoSpecific(r: Recipe): Recipe {
  const c = cloneRecipe(r);
  c.crop = null;
  c.rotate90 = 0;
  c.flipH = false;
  c.flipV = false;
  c.angle = 0;
  c.spots = [];
  c.redeye = [];
  return c;
}

const thumbQueue: number[] = [];
const thumbQueued = new Set<number>();
let thumbInFlight = 0;
// bumping the generation discards in-flight thumbnail responses after invalidation
let thumbGen = 0;

function resetThumbs() {
  thumbGen++;
  thumbQueue.length = 0;
  thumbQueued.clear();
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: { id: number; recipe: Recipe } | null = null;

// history entries are coalesced in time so a slider drag is one undo step
let lastHistoryAt = 0;

function flushSave() {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = undefined;
  if (pendingSave) {
    const { id, recipe } = pendingSave;
    pendingSave = null;
    void api.saveEdits(id, recipe).catch(console.error);
  }
}

export const useStore = create<AppStore>()((set, get) => {
  const pumpThumbs = () => {
    while (thumbInFlight < 3 && thumbQueue.length > 0) {
      const id = thumbQueue.shift()!;
      const gen = thumbGen;
      thumbInFlight++;
      api
        .getThumbnail(id)
        .then((url) => {
          if (gen === thumbGen) set((s) => ({ thumbs: { ...s.thumbs, [id]: url } }));
        })
        .catch(() => {})
        .finally(() => {
          thumbInFlight--;
          thumbQueued.delete(id);
          pumpThumbs();
        });
    }
  };

  const scheduleSave = (id: number, recipe: Recipe) => {
    pendingSave = { id, recipe };
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      const p = pendingSave;
      pendingSave = null;
      if (p) {
        void api.saveEdits(p.id, p.recipe).catch(console.error);
        set((s) => ({
          photos: s.photos.map((ph) => (ph.id === p.id ? { ...ph, hasEdits: true } : ph)),
        }));
      }
    }, 600);
  };

  const pushHistory = (current: Recipe) => {
    const now = Date.now();
    if (now - lastHistoryAt > 700) {
      set((s) => ({ history: [...s.history.slice(-49), cloneRecipe(current)] }));
    }
    lastHistoryAt = now;
  };

  return {
    view: "library",
    folders: [],
    photos: [],
    activeFolderId: null,
    activeId: null,
    selection: [],
    filterRating: 0,
    filterFlag: null,
    thumbs: {},
    recipe: cloneRecipe(DEFAULT_RECIPE),
    recipeFor: null,
    tool: "none",
    spotRadius: 0.008,
    exportOpen: false,
    importing: false,
    presets: [],
    gridVisible: false,
    history: [],
    settingsClipboard: null,
    showBefore: false,
    filterLabel: null,
    filterTag: null,
    filterText: "",
    sortBy: "captured" as const,
    sortDir: 1 as const,
    cropAspect: "free",
    filterDups: false,
    dupScan: null,
    dupSummary: null,

    setView: (v) => set({ view: v, tool: "none" }),

    refreshFolders: async () => {
      set({ folders: await api.listFolders() });
    },

    refreshPhotos: async () => {
      const photos = await api.listPhotos(get().activeFolderId);
      set({ photos });
    },

    selectFolder: async (id) => {
      set({ activeFolderId: id });
      await get().refreshPhotos();
    },

    importFolder: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, title: "Import folder into Revela" });
      if (typeof dir !== "string") return;
      set({ importing: true });
      try {
        await api.importFolder(dir);
        await get().refreshFolders();
        await get().refreshPhotos();
      } finally {
        set({ importing: false });
      }
    },

    removeFolder: async (id) => {
      await api.removeFolder(id);
      if (get().activeFolderId === id) set({ activeFolderId: null });
      // ids may be reused by the DB — drop every cached thumbnail
      resetThumbs();
      set({ thumbs: {} });
      await get().refreshFolders();
      await get().refreshPhotos();
    },

    requestThumb: (id) => {
      if (get().thumbs[id] || thumbQueued.has(id)) return;
      thumbQueued.add(id);
      thumbQueue.push(id);
      pumpThumbs();
    },

    setActive: (id) => set({ activeId: id, selection: id === null ? [] : [id] }),

    toggleSelect: (id) =>
      set((s) => ({
        activeId: id,
        selection: s.selection.includes(id)
          ? s.selection.filter((i) => i !== id)
          : [...s.selection, id],
      })),

    rangeSelect: (id) => {
      const s = get();
      const ph = filteredPhotos(s);
      const a = ph.findIndex((p) => p.id === s.activeId);
      const b = ph.findIndex((p) => p.id === id);
      if (a < 0 || b < 0) {
        s.setActive(id);
        return;
      }
      const [lo, hi] = a < b ? [a, b] : [b, a];
      set({ selection: ph.slice(lo, hi + 1).map((p) => p.id) });
    },

    setRating: async (ids, rating) => {
      await Promise.all(ids.map((id) => api.setRating(id, rating)));
      set((s) => ({
        photos: s.photos.map((p) => (ids.includes(p.id) ? { ...p, rating } : p)),
      }));
    },

    setFlag: async (ids, flag) => {
      await Promise.all(ids.map((id) => api.setFlag(id, flag)));
      set((s) => ({
        photos: s.photos.map((p) => (ids.includes(p.id) ? { ...p, flag } : p)),
      }));
    },

    setTags: async (id, tags) => {
      await api.setTags(id, tags);
      set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, tags } : p)) }));
    },

    openDevelop: async (id) => {
      set({ view: "develop" });
      await get().loadRecipeFor(id);
    },

    loadRecipeFor: async (id) => {
      flushSave();
      lastHistoryAt = 0;
      set({ activeId: id, selection: [id], recipeFor: null, tool: "none", history: [] });
      const r = await api.getEdits(id);
      set({ recipe: r ? r : cloneRecipe(DEFAULT_RECIPE), recipeFor: id });
    },

    updateRecipe: (patch) => {
      const s = get();
      if (s.recipeFor === null) return;
      pushHistory(s.recipe);
      const recipe = { ...s.recipe, ...patch };
      set({ recipe });
      scheduleSave(s.recipeFor, recipe);
    },

    updateNegative: (patch) => {
      const s = get();
      if (s.recipeFor === null) return;
      pushHistory(s.recipe);
      const recipe = { ...s.recipe, negative: { ...s.recipe.negative, ...patch } };
      set({ recipe });
      scheduleSave(s.recipeFor, recipe);
    },

    resetRecipe: () => {
      const s = get();
      if (s.recipeFor === null) return;
      pushHistory(s.recipe);
      lastHistoryAt = 0;
      const recipe = cloneRecipe(DEFAULT_RECIPE);
      set({ recipe });
      scheduleSave(s.recipeFor, recipe);
    },

    undo: () => {
      const s = get();
      if (s.recipeFor === null || s.history.length === 0) return;
      const prev = s.history[s.history.length - 1];
      lastHistoryAt = 0;
      set({ recipe: prev, history: s.history.slice(0, -1) });
      scheduleSave(s.recipeFor, prev);
    },

    setTool: (t) => set((s) => ({ tool: s.tool === t ? "none" : t })),

    setSpotRadius: (r) => set({ spotRadius: r }),

    setExportOpen: (open) => set({ exportOpen: open }),

    navigate: (dir) => {
      const s = get();
      const ph = filteredPhotos(s);
      if (ph.length === 0) return;
      const idx = ph.findIndex((p) => p.id === s.activeId);
      const nextIdx = idx < 0 ? 0 : Math.min(ph.length - 1, Math.max(0, idx + dir));
      const next = ph[nextIdx];
      if (!next || next.id === s.activeId) return;
      if (s.view === "develop") void s.loadRecipeFor(next.id);
      else s.setActive(next.id);
    },

    setFilterRating: (n) => set({ filterRating: n }),
    setFilterFlag: (f) => set({ filterFlag: f }),

    setGridVisible: (v) => set({ gridVisible: v }),

    refreshPresets: async () => {
      set({ presets: await api.listPresets() });
    },

    saveCurrentAsPreset: async (name) => {
      // presets carry tone/colour/negative settings, not photo-specific geometry & spots
      const r = stripPhotoSpecific(get().recipe);
      await api.savePreset(name, r);
      await get().refreshPresets();
    },

    applyPreset: async (id) => {
      const s = get();
      if (s.recipeFor === null) return;
      const p = await api.getPreset(id);
      if (!p) return;
      const cur = s.recipe;
      s.updateRecipe({
        ...p,
        crop: cur.crop,
        rotate90: cur.rotate90,
        flipH: cur.flipH,
        flipV: cur.flipV,
        angle: cur.angle,
        spots: cur.spots,
      });
    },

    deletePreset: async (id) => {
      await api.deletePreset(id);
      await get().refreshPresets();
    },

    renameActive: async (newStem) => {
      const id = get().activeId;
      if (id === null) return;
      const res = await api.renamePhoto(id, newStem);
      set((s) => ({
        photos: s.photos.map((p) =>
          p.id === id ? { ...p, path: res.path, filename: res.filename } : p,
        ),
      }));
    },

    copySettings: () => {
      const s = get();
      if (s.recipeFor === null) return;
      set({ settingsClipboard: stripPhotoSpecific(s.recipe) });
    },

    pasteSettings: async () => {
      const s = get();
      const clip = s.settingsClipboard;
      if (!clip) return;
      const ids = s.selection.length > 0 ? s.selection : s.activeId !== null ? [s.activeId] : [];
      if (ids.length === 0) return;
      for (const id of ids) {
        const existing = (await api.getEdits(id)) ?? cloneRecipe(DEFAULT_RECIPE);
        const merged: Recipe = {
          ...cloneRecipe(clip),
          crop: existing.crop,
          rotate90: existing.rotate90,
          flipH: existing.flipH,
          flipV: existing.flipV,
          angle: existing.angle,
          spots: existing.spots,
        };
        await api.saveEdits(id, merged);
        if (get().recipeFor === id) {
          pushHistory(get().recipe);
          lastHistoryAt = 0;
          set({ recipe: merged });
        }
      }
      set((st) => ({
        photos: st.photos.map((p) => (ids.includes(p.id) ? { ...p, hasEdits: true } : p)),
      }));
    },

    setShowBefore: (v) => set({ showBefore: v }),

    setColorLabel: async (ids, label) => {
      await Promise.all(ids.map((id) => api.setColorLabel(id, label)));
      set((s) => ({
        photos: s.photos.map((p) => (ids.includes(p.id) ? { ...p, colorLabel: label } : p)),
      }));
    },

    removePhotos: async (ids) => {
      await api.removePhotos(ids);
      set((s) => {
        const thumbs = { ...s.thumbs };
        for (const id of ids) delete thumbs[id];
        return {
          photos: s.photos.filter((p) => !ids.includes(p.id)),
          selection: s.selection.filter((i) => !ids.includes(i)),
          activeId: s.activeId !== null && ids.includes(s.activeId) ? null : s.activeId,
          thumbs,
        };
      });
    },

    setFilterLabel: (l) => set({ filterLabel: l }),
    setFilterTag: (t) => set({ filterTag: t }),
    setFilterText: (t) => set({ filterText: t }),
    setSortBy: (sb) => set({ sortBy: sb }),
    toggleSortDir: () => set((s) => ({ sortDir: s.sortDir === 1 ? -1 : 1 })),
    setCropAspect: (a) => set({ cropAspect: a }),

    findDuplicates: async (strictness) => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<{ done: number; total: number }>("dup-progress", (e) =>
        set({ dupScan: e.payload }),
      );
      set({ dupScan: { done: 0, total: 0 }, dupSummary: null });
      try {
        const res = await api.findDuplicates(get().activeFolderId, strictness);
        await get().refreshPhotos();
        set({
          filterDups: res.groups > 0,
          dupSummary:
            res.groups > 0 ? `${res.groups} group${res.groups === 1 ? "" : "s"}` : "none found",
        });
      } finally {
        unlisten();
        set({ dupScan: null });
      }
    },

    clearDuplicates: async () => {
      await api.clearDuplicates(get().activeFolderId);
      set({ filterDups: false, dupSummary: null });
      await get().refreshPhotos();
    },

    setFilterDups: (v) => set({ filterDups: v }),

    rejectNonBest: async () => {
      const ids = get()
        .photos.filter((p) => p.dupGroup !== null && !p.dupBest && p.flag !== 2)
        .map((p) => p.id);
      if (ids.length === 0) return;
      await get().setFlag(ids, 2);
    },
  };
});

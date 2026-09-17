import { create } from "zustand";
import * as api from "./api";
import {
  cloneRecipe,
  DEFAULT_RECIPE,
  type Folder,
  type NegativeParams,
  type Photo,
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
  setTool(t: Tool): void;
  setSpotRadius(r: number): void;
  setExportOpen(open: boolean): void;
  navigate(dir: 1 | -1): void;
  setFilterRating(n: number): void;
  setFilterFlag(f: number | null): void;
}

export function filteredPhotos(s: {
  photos: Photo[];
  filterRating: number;
  filterFlag: number | null;
}): Photo[] {
  return s.photos.filter(
    (p) =>
      p.rating >= s.filterRating && (s.filterFlag === null || p.flag === s.filterFlag),
  );
}

const thumbQueue: number[] = [];
const thumbQueued = new Set<number>();
let thumbInFlight = 0;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: { id: number; recipe: Recipe } | null = null;

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
      thumbInFlight++;
      api
        .getThumbnail(id)
        .then((url) => set((s) => ({ thumbs: { ...s.thumbs, [id]: url } })))
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
      set({ activeId: id, selection: [id], recipeFor: null, tool: "none" });
      const r = await api.getEdits(id);
      set({ recipe: r ? r : cloneRecipe(DEFAULT_RECIPE), recipeFor: id });
    },

    updateRecipe: (patch) => {
      const s = get();
      if (s.recipeFor === null) return;
      const recipe = { ...s.recipe, ...patch };
      set({ recipe });
      scheduleSave(s.recipeFor, recipe);
    },

    updateNegative: (patch) => {
      const s = get();
      if (s.recipeFor === null) return;
      const recipe = { ...s.recipe, negative: { ...s.recipe.negative, ...patch } };
      set({ recipe });
      scheduleSave(s.recipeFor, recipe);
    },

    resetRecipe: () => {
      const s = get();
      if (s.recipeFor === null) return;
      const recipe = cloneRecipe(DEFAULT_RECIPE);
      set({ recipe });
      scheduleSave(s.recipeFor, recipe);
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
  };
});

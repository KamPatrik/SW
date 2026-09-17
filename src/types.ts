export interface Folder {
  id: number;
  path: string;
}

export interface Photo {
  id: number;
  folderId: number;
  path: string;
  filename: string;
  ext: string;
  isRaw: boolean;
  rating: number;
  flag: number; // 0 none, 1 pick, 2 reject
  colorLabel: string | null;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
  hasEdits: boolean;
  tags: string[];
}

export interface NegativeParams {
  enabled: boolean;
  filmBase: [number, number, number] | null;
  gamma: number;
  redBalance: number;
  blueBalance: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Spot {
  x: number;
  y: number;
  radius: number; // relative to image width
}

export interface Recipe {
  negative: NegativeParams;
  wbTemp: number;
  wbTint: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
  saturation: number;
  sharpen: number;
  toneCurve: [number, number][];
  rotate90: number;
  flipH: boolean;
  flipV: boolean;
  angle: number;
  crop: CropRect | null;
  spots: Spot[];
}

export interface HistogramData {
  r: number[];
  g: number[];
  b: number[];
  l: number[];
}

export interface RenderResult {
  dataUrl: string;
  width: number;
  height: number;
  histogram: HistogramData;
}

export interface ImportResult {
  folderId: number;
  added: number;
  total: number;
}

export type Tool = "none" | "spot" | "crop" | "pickBase";

export const DEFAULT_RECIPE: Recipe = {
  negative: { enabled: false, filmBase: null, gamma: 1.0, redBalance: 0, blueBalance: 0 },
  wbTemp: 0,
  wbTint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
  sharpen: 0,
  toneCurve: [
    [0, 0],
    [1, 1],
  ],
  rotate90: 0,
  flipH: false,
  flipV: false,
  angle: 0,
  crop: null,
  spots: [],
};

export function cloneRecipe(r: Recipe): Recipe {
  return {
    ...r,
    negative: { ...r.negative, filmBase: r.negative.filmBase ? [...r.negative.filmBase] : null },
    toneCurve: r.toneCurve.map((p) => [...p] as [number, number]),
    crop: r.crop ? { ...r.crop } : null,
    spots: r.spots.map((s) => ({ ...s })),
  };
}

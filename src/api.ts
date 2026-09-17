import { invoke } from "@tauri-apps/api/core";
import type { Folder, ImportResult, Photo, Recipe, RenderResult } from "./types";

export const importFolder = (path: string) => invoke<ImportResult>("import_folder", { path });

export const listFolders = () => invoke<Folder[]>("list_folders");

export const removeFolder = (folderId: number) => invoke<void>("remove_folder", { folderId });

export const listPhotos = (folderId: number | null) =>
  invoke<Photo[]>("list_photos", { folderId });

export const getThumbnail = (photoId: number) => invoke<string>("get_thumbnail", { photoId });

export const renderPreview = (photoId: number, recipe: Recipe, ignoreCrop: boolean) =>
  invoke<RenderResult>("render_preview", { photoId, recipe, ignoreCrop });

export const sampleBaseColor = (
  photoId: number,
  x: number,
  y: number,
  recipe: Recipe,
  ignoreCrop: boolean,
) =>
  invoke<[number, number, number]>("sample_base_color", { photoId, x, y, recipe, ignoreCrop });

export const setRating = (photoId: number, rating: number) =>
  invoke<void>("set_rating", { photoId, rating });

export const setFlag = (photoId: number, flag: number) =>
  invoke<void>("set_flag", { photoId, flag });

export const setColorLabel = (photoId: number, label: string | null) =>
  invoke<void>("set_color_label", { photoId, label });

export const setTags = (photoId: number, tags: string[]) =>
  invoke<void>("set_tags", { photoId, tags });

export const saveEdits = (photoId: number, recipe: Recipe) =>
  invoke<void>("save_edits", { photoId, recipe });

export const getEdits = (photoId: number) => invoke<Recipe | null>("get_edits", { photoId });

export const exportPhoto = (
  photoId: number,
  destDir: string,
  format: "jpeg" | "png",
  quality?: number,
  maxSize?: number,
) => invoke<string>("export_photo", { photoId, destDir, format, quality, maxSize });

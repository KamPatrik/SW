use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use tauri::State;
use walkdir::WalkDir;

use crate::catalog::{Folder, Photo};
use crate::engine::pipeline::{apply_recipe, Recipe};
use crate::engine::{decode, export, histogram};
use crate::state::{base_for, AppState};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    let s = e.to_string();
    crate::log_line("ERROR", &s);
    s
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub folder_id: i64,
    pub added: usize,
    pub total: usize,
}

#[tauri::command]
pub async fn import_folder(state: State<'_, AppState>, path: String) -> CmdResult<ImportResult> {
    let catalog = state.catalog.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let files: Vec<PathBuf> = WalkDir::new(&path)
            .max_depth(10)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.into_path())
            .filter(|p| {
                p.extension()
                    .map(|x| decode::is_supported_ext(&x.to_string_lossy()))
                    .unwrap_or(false)
            })
            .collect();

        let cat = catalog.lock().map_err(|_| "catalog lock".to_string())?;
        let folder_id = cat.upsert_folder(&path).map_err(err)?;
        let mut added = 0usize;
        for file in &files {
            let ext = file
                .extension()
                .map(|x| x.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            let is_raw = decode::is_raw_ext(&ext);
            let (captured, _) = decode::read_exif_meta(file);
            let dims = if is_raw { None } else { image::image_dimensions(file).ok() };
            if cat
                .insert_photo(
                    folder_id,
                    file,
                    &ext,
                    is_raw,
                    dims.map(|d| d.0),
                    dims.map(|d| d.1),
                    captured,
                )
                .map_err(err)?
            {
                added += 1;
            }
        }
        Ok(ImportResult { folder_id, added, total: files.len() })
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn list_folders(state: State<'_, AppState>) -> CmdResult<Vec<Folder>> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .list_folders()
        .map_err(err)
}

#[tauri::command]
pub fn remove_folder(state: State<'_, AppState>, folder_id: i64) -> CmdResult<()> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .remove_folder(folder_id)
        .map_err(err)
}

#[tauri::command]
pub fn list_photos(state: State<'_, AppState>, folder_id: Option<i64>) -> CmdResult<Vec<Photo>> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .list_photos(folder_id)
        .map_err(err)
}

#[tauri::command]
pub async fn get_thumbnail(state: State<'_, AppState>, photo_id: i64) -> CmdResult<String> {
    let path = state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .photo_path(photo_id)
        .map_err(err)?;
    let thumb_path = state.thumbs_dir.join(format!("{photo_id}.jpg"));
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        crate::thumbs::ensure_thumb(&path, &thumb_path).map_err(err)
    })
    .await
    .map_err(err)??;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    pub data_url: String,
    pub width: usize,
    pub height: usize,
    pub histogram: histogram::Histogram,
}

#[tauri::command]
pub async fn render_preview(
    state: State<'_, AppState>,
    photo_id: i64,
    recipe: Recipe,
    ignore_crop: Option<bool>,
) -> CmdResult<RenderResult> {
    let path = state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .photo_path(photo_id)
        .map_err(err)?;
    let cache = state.cache.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let base = base_for(&cache, photo_id, &path)?;
        let rendered = apply_recipe(&base, &recipe, ignore_crop.unwrap_or(false));
        let hist = histogram::compute(&rendered);
        let jpeg = export::encode_jpeg(&rendered, 88).map_err(err)?;
        Ok(RenderResult {
            data_url: format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(jpeg)
            ),
            width: rendered.width,
            height: rendered.height,
            histogram: hist,
        })
    })
    .await
    .map_err(err)?
}

/// Sample the linear-light colour at normalized display coords (film-base picker).
/// Applies spots + geometry of the recipe but not the negative inversion or tone ops.
#[tauri::command]
pub async fn sample_base_color(
    state: State<'_, AppState>,
    photo_id: i64,
    x: f32,
    y: f32,
    recipe: Recipe,
    ignore_crop: Option<bool>,
) -> CmdResult<[f32; 3]> {
    let path = state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .photo_path(photo_id)
        .map_err(err)?;
    let cache = state.cache.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let base = base_for(&cache, photo_id, &path)?;
        let healed = crate::engine::retouch::heal_spots(&base, &recipe.spots);
        let geo = crate::engine::geometry::apply(healed, &recipe, ignore_crop.unwrap_or(false));
        let px = (x.clamp(0.0, 1.0) * (geo.width - 1) as f32) as i64;
        let py = (y.clamp(0.0, 1.0) * (geo.height - 1) as f32) as i64;
        // median of a 5x5 window per channel
        let mut out = [0.0f32; 3];
        for c in 0..3 {
            let mut vals = Vec::with_capacity(25);
            for dy in -2i64..=2 {
                for dx in -2i64..=2 {
                    let sx = (px + dx).clamp(0, geo.width as i64 - 1) as usize;
                    let sy = (py + dy).clamp(0, geo.height as i64 - 1) as usize;
                    vals.push(geo.px(sx, sy)[c]);
                }
            }
            vals.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            out[c] = vals[vals.len() / 2];
        }
        Ok(out)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn set_rating(state: State<'_, AppState>, photo_id: i64, rating: i64) -> CmdResult<()> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .set_rating(photo_id, rating)
        .map_err(err)
}

#[tauri::command]
pub fn set_flag(state: State<'_, AppState>, photo_id: i64, flag: i64) -> CmdResult<()> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .set_flag(photo_id, flag)
        .map_err(err)
}

#[tauri::command]
pub fn set_color_label(
    state: State<'_, AppState>,
    photo_id: i64,
    label: Option<String>,
) -> CmdResult<()> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .set_color_label(photo_id, label)
        .map_err(err)
}

#[tauri::command]
pub fn set_tags(state: State<'_, AppState>, photo_id: i64, tags: Vec<String>) -> CmdResult<()> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .set_tags(photo_id, &tags)
        .map_err(err)
}

#[tauri::command]
pub fn save_edits(state: State<'_, AppState>, photo_id: i64, recipe: Recipe) -> CmdResult<()> {
    let json = serde_json::to_string(&recipe).map_err(err)?;
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .save_edits(photo_id, &json)
        .map_err(err)
}

#[tauri::command]
pub fn get_edits(state: State<'_, AppState>, photo_id: i64) -> CmdResult<Option<Recipe>> {
    let json = state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .get_edits(photo_id)
        .map_err(err)?;
    match json {
        Some(j) => Ok(serde_json::from_str(&j).ok()),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn export_photo(
    state: State<'_, AppState>,
    photo_id: i64,
    dest_dir: String,
    format: String,
    quality: Option<u8>,
    max_size: Option<u32>,
) -> CmdResult<String> {
    let (path, filename, recipe) = {
        let cat = state.catalog.lock().map_err(|_| "catalog lock".to_string())?;
        let path = cat.photo_path(photo_id).map_err(err)?;
        let filename = cat.photo_filename(photo_id).map_err(err)?;
        let recipe: Recipe = cat
            .get_edits(photo_id)
            .map_err(err)?
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default();
        (path, filename, recipe)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let base = decode::decode_base(Path::new(&path), max_size).map_err(err)?;
        let rendered = apply_recipe(&base, &recipe, false);
        let stem = Path::new(&filename)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "photo".into());
        let (bytes, ext) = match format.as_str() {
            "png" => (export::encode_png(&rendered).map_err(err)?, "png"),
            _ => (
                export::encode_jpeg(&rendered, quality.unwrap_or(90)).map_err(err)?,
                "jpg",
            ),
        };
        let mut out_path = PathBuf::from(&dest_dir).join(format!("{stem}-revela.{ext}"));
        let mut n = 1;
        while out_path.exists() {
            out_path = PathBuf::from(&dest_dir).join(format!("{stem}-revela-{n}.{ext}"));
            n += 1;
        }
        std::fs::write(&out_path, bytes).map_err(err)?;
        Ok(out_path.to_string_lossy().to_string())
    })
    .await
    .map_err(err)?
}

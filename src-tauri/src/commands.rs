use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use tauri::{Emitter, State};
use walkdir::WalkDir;

use crate::catalog::{Folder, Photo, Preset};
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
    let ids = {
        let cat = state.catalog.lock().map_err(|_| "catalog lock".to_string())?;
        let ids = cat.photo_ids_in_folder(folder_id).map_err(err)?;
        cat.remove_folder(folder_id).map_err(err)?;
        ids
    };
    for id in ids {
        crate::thumbs::remove_thumbs_for(&state.thumbs_dir, id);
    }
    Ok(())
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
    let thumb_path = crate::thumbs::thumb_path_for(&state.thumbs_dir, photo_id, &path);
    let dir = state.thumbs_dir.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        if !thumb_path.exists() {
            // drop stale versions from a previous file at this (reused) id
            crate::thumbs::remove_thumbs_for(&dir, photo_id);
        }
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

/// Median of a 5x5 window per channel at normalized coords.
fn median5(img: &crate::engine::ImageF32, x: f32, y: f32) -> [f32; 3] {
    let px = (x.clamp(0.0, 1.0) * (img.width - 1) as f32) as i64;
    let py = (y.clamp(0.0, 1.0) * (img.height - 1) as f32) as i64;
    let mut out = [0.0f32; 3];
    for c in 0..3 {
        let mut vals = Vec::with_capacity(25);
        for dy in -2i64..=2 {
            for dx in -2i64..=2 {
                let sx = (px + dx).clamp(0, img.width as i64 - 1) as usize;
                let sy = (py + dy).clamp(0, img.height as i64 - 1) as usize;
                vals.push(img.px(sx, sy)[c]);
            }
        }
        vals.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        out[c] = vals[vals.len() / 2];
    }
    out
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
        let orient = crate::engine::geometry::apply_orient((*base).clone(), &recipe);
        let healed = crate::engine::retouch::heal_spots(&orient, &recipe.spots);
        let geo = crate::engine::geometry::apply_crop(healed, &recipe, ignore_crop.unwrap_or(false));
        Ok(median5(&geo, x, y))
    })
    .await
    .map_err(err)?
}

/// Sample the linear colour as it enters the white-balance stage (WB eyedropper):
/// spots + geometry + negative inversion (when enabled), before tone ops.
#[tauri::command]
pub async fn sample_wb_color(
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
        let orient = crate::engine::geometry::apply_orient((*base).clone(), &recipe);
        let healed = crate::engine::retouch::heal_spots(&orient, &recipe.spots);
        let mut geo = crate::engine::geometry::apply_crop(healed, &recipe, ignore_crop.unwrap_or(false));
        if recipe.negative.enabled {
            geo = crate::engine::negative::convert(&geo, &recipe.negative);
        }
        Ok(median5(&geo, x, y))
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub path: String,
    pub filename: String,
}

#[tauri::command]
pub fn rename_photo(
    state: State<'_, AppState>,
    photo_id: i64,
    new_stem: String,
) -> CmdResult<RenameResult> {
    let stem = new_stem.trim();
    if stem.is_empty() || stem.len() > 180 {
        return Err("Invalid file name".into());
    }
    let forbidden =
        |c: char| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || (c as u32) < 32;
    if stem.chars().any(forbidden) || stem.ends_with('.') {
        return Err("The name contains characters that are not allowed".into());
    }
    let cat = state.catalog.lock().map_err(|_| "catalog lock".to_string())?;
    let old_path = PathBuf::from(cat.photo_path(photo_id).map_err(err)?);
    let parent = old_path
        .parent()
        .ok_or_else(|| "photo has no parent directory".to_string())?;
    let ext = old_path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    let new_filename = if ext.is_empty() { stem.to_string() } else { format!("{stem}.{ext}") };
    let new_path = parent.join(&new_filename);
    if new_path == old_path {
        return Ok(RenameResult {
            path: old_path.to_string_lossy().to_string(),
            filename: new_filename,
        });
    }
    if new_path.exists() {
        return Err("A file with this name already exists".into());
    }
    std::fs::rename(&old_path, &new_path).map_err(err)?;
    cat.rename_photo(photo_id, &new_path.to_string_lossy(), &new_filename)
        .map_err(err)?;
    Ok(RenameResult {
        path: new_path.to_string_lossy().to_string(),
        filename: new_filename,
    })
}

#[tauri::command]
pub fn list_presets(state: State<'_, AppState>) -> CmdResult<Vec<Preset>> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .list_presets()
        .map_err(err)
}

#[tauri::command]
pub fn save_preset(state: State<'_, AppState>, name: String, recipe: Recipe) -> CmdResult<i64> {
    let name = name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err("Invalid preset name".into());
    }
    let json = serde_json::to_string(&recipe).map_err(err)?;
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .save_preset(name, &json)
        .map_err(err)
}

#[tauri::command]
pub fn delete_preset(state: State<'_, AppState>, preset_id: i64) -> CmdResult<()> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .delete_preset(preset_id)
        .map_err(err)
}

#[tauri::command]
pub fn get_preset(state: State<'_, AppState>, preset_id: i64) -> CmdResult<Option<Recipe>> {
    let json = state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .get_preset(preset_id)
        .map_err(err)?;
    Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExifInfo {
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<String>,
    pub shutter: Option<String>,
    pub aperture: Option<String>,
    pub focal: Option<String>,
    pub captured: Option<String>,
    pub file_size: Option<u64>,
}

#[tauri::command]
pub fn get_exif(state: State<'_, AppState>, photo_id: i64) -> CmdResult<ExifInfo> {
    let path = state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .photo_path(photo_id)
        .map_err(err)?;
    let mut info = ExifInfo {
        camera: None,
        lens: None,
        iso: None,
        shutter: None,
        aperture: None,
        focal: None,
        captured: None,
        file_size: std::fs::metadata(&path).ok().map(|m| m.len()),
    };
    if let Ok(f) = std::fs::File::open(&path) {
        let mut rdr = std::io::BufReader::new(f);
        if let Ok(ex) = exif::Reader::new().read_from_container(&mut rdr) {
            let get = |tag: exif::Tag| {
                ex.get_field(tag, exif::In::PRIMARY)
                    .map(|f| f.display_value().with_unit(&ex).to_string().trim_matches('"').to_string())
            };
            info.camera = get(exif::Tag::Model);
            info.lens = get(exif::Tag::LensModel);
            info.iso = get(exif::Tag::PhotographicSensitivity);
            info.shutter = get(exif::Tag::ExposureTime);
            info.aperture = get(exif::Tag::FNumber);
            info.focal = get(exif::Tag::FocalLength);
            info.captured = get(exif::Tag::DateTimeOriginal);
        }
    }
    Ok(info)
}

#[tauri::command]
pub fn remove_photos(state: State<'_, AppState>, ids: Vec<i64>) -> CmdResult<()> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .remove_photos(&ids)
        .map_err(err)?;
    for id in &ids {
        crate::thumbs::remove_thumbs_for(&state.thumbs_dir, *id);
    }
    Ok(())
}

/// 64-bit difference hash of a grayscale image (gradient signature).
fn dhash(gray: &image::GrayImage) -> u64 {
    let small = image::imageops::resize(gray, 9, 8, image::imageops::FilterType::Triangle);
    let mut bits = 0u64;
    let mut i = 0;
    for y in 0..8 {
        for x in 0..8 {
            if small.get_pixel(x, y)[0] > small.get_pixel(x + 1, y)[0] {
                bits |= 1u64 << i;
            }
            i += 1;
        }
    }
    bits
}

/// Sharpness proxy: variance of the 4-neighbour Laplacian on a 128px version.
fn sharpness(gray: &image::GrayImage) -> f32 {
    let g = image::imageops::resize(gray, 128, 128, image::imageops::FilterType::Triangle);
    let px = |x: u32, y: u32| g.get_pixel(x, y)[0] as f32;
    let mut sum = 0.0f64;
    let mut sum2 = 0.0f64;
    let mut n = 0u32;
    for y in 1..127 {
        for x in 1..127 {
            let l = 4.0 * px(x, y) - px(x - 1, y) - px(x + 1, y) - px(x, y - 1) - px(x, y + 1);
            sum += l as f64;
            sum2 += (l * l) as f64;
            n += 1;
        }
    }
    let mean = sum / n as f64;
    ((sum2 / n as f64) - mean * mean).max(0.0) as f32
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupResult {
    pub groups: usize,
    pub flagged: usize,
}

#[derive(Clone, Serialize)]
struct DupProgress {
    done: usize,
    total: usize,
}

/// Find visually near-identical photos via perceptual hashing of thumbnails,
/// group them and mark the objectively best frame of each group
/// (sharpness > resolution > format > file size).
#[tauri::command]
pub async fn find_duplicates(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    folder_id: Option<i64>,
    strictness: Option<String>,
) -> CmdResult<DupResult> {
    let photos = state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .list_photos(folder_id)
        .map_err(err)?;
    let thumbs_dir = state.thumbs_dir.clone();
    let catalog = state.catalog.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use rayon::prelude::*;
        use std::sync::atomic::{AtomicUsize, Ordering};

        let threshold: u32 = match strictness.as_deref() {
            Some("strict") => 3,
            Some("loose") => 12,
            _ => 7,
        };

        struct Feat {
            id: i64,
            hash: u64,
            sharp: f32,
            mp: f32,
            fmt: f32,
            size: u64,
        }

        let total = photos.len();
        let done = AtomicUsize::new(0);
        // small pool: thumbnail generation may decode full RAWs (memory heavy)
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(3)
            .build()
            .map_err(err)?;
        let feats: Vec<Feat> = pool.install(|| {
            photos
                .par_iter()
                .filter_map(|p| {
                    let thumb_path = crate::thumbs::thumb_path_for(&thumbs_dir, p.id, &p.path);
                    let res = (|| {
                        let bytes = crate::thumbs::ensure_thumb(&p.path, &thumb_path).ok()?;
                        let gray = image::load_from_memory(&bytes).ok()?.to_luma8();
                        let mp = match (p.width, p.height) {
                            (Some(w), Some(h)) => (w * h) as f32 / 1e6,
                            _ => 0.0,
                        };
                        let fmt = if p.is_raw {
                            3.0
                        } else if matches!(p.ext.as_str(), "tif" | "tiff" | "png") {
                            1.5
                        } else {
                            0.0
                        };
                        Some(Feat {
                            id: p.id,
                            hash: dhash(&gray),
                            sharp: sharpness(&gray),
                            mp,
                            fmt,
                            size: std::fs::metadata(&p.path).map(|m| m.len()).unwrap_or(0),
                        })
                    })();
                    let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if n % 5 == 0 || n == total {
                        let _ = app.emit("dup-progress", DupProgress { done: n, total });
                    }
                    res
                })
                .collect()
        });

        // union-find clustering by Hamming distance of the hashes
        let n = feats.len();
        let mut parent: Vec<usize> = (0..n).collect();
        fn find(p: &mut [usize], mut i: usize) -> usize {
            while p[i] != i {
                p[i] = p[p[i]];
                i = p[i];
            }
            i
        }
        for i in 0..n {
            for j in (i + 1)..n {
                if (feats[i].hash ^ feats[j].hash).count_ones() <= threshold {
                    let a = find(&mut parent, i);
                    let b = find(&mut parent, j);
                    if a != b {
                        parent[a] = b;
                    }
                }
            }
        }
        let mut groups: std::collections::HashMap<usize, Vec<usize>> =
            std::collections::HashMap::new();
        for i in 0..n {
            let root = find(&mut parent, i);
            groups.entry(root).or_default().push(i);
        }

        let cat = catalog.lock().map_err(|_| "catalog lock".to_string())?;
        cat.clear_dups(folder_id).map_err(err)?;
        let mut gid = 0i64;
        let mut flagged = 0usize;
        for members in groups.values().filter(|v| v.len() >= 2) {
            gid += 1;
            let max_sharp = members.iter().map(|&m| feats[m].sharp).fold(1e-6f32, f32::max);
            let max_mp = members.iter().map(|&m| feats[m].mp).fold(1e-6f32, f32::max);
            let max_size = members.iter().map(|&m| feats[m].size).max().unwrap_or(1).max(1);
            let score = |m: usize| {
                feats[m].sharp / max_sharp * 4.0
                    + feats[m].mp / max_mp * 2.0
                    + feats[m].fmt
                    + feats[m].size as f32 / max_size as f32
            };
            let best = members
                .iter()
                .copied()
                .max_by(|&a, &b| score(a).partial_cmp(&score(b)).unwrap_or(std::cmp::Ordering::Equal))
                .unwrap_or(members[0]);
            for &m in members {
                cat.set_dup(feats[m].id, gid, m == best).map_err(err)?;
                flagged += 1;
            }
        }
        Ok(DupResult { groups: gid as usize, flagged })
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn clear_duplicates(state: State<'_, AppState>, folder_id: Option<i64>) -> CmdResult<()> {
    state
        .catalog
        .lock()
        .map_err(|_| "catalog lock".to_string())?
        .clear_dups(folder_id)
        .map_err(err)
}

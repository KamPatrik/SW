use std::io::BufReader;
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use image::DynamicImage;
use rawler::imgop::develop::RawDevelop;

use super::ImageF32;

pub const RAW_EXTS: &[&str] = &[
    "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "dng", "raf", "orf", "rw2", "pef",
    "srw", "erf", "kdc", "dcr", "3fr", "mef", "mos", "iiq", "x3f",
];

pub const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff", "webp", "bmp"];

pub fn is_raw_ext(ext: &str) -> bool {
    RAW_EXTS.contains(&ext.to_ascii_lowercase().as_str())
}

pub fn is_supported_ext(ext: &str) -> bool {
    let e = ext.to_ascii_lowercase();
    RAW_EXTS.contains(&e.as_str()) || IMAGE_EXTS.contains(&e.as_str())
}

/// EXIF metadata that matters at import time.
pub fn read_exif_meta(path: &Path) -> (Option<String>, u32) {
    let mut captured = None;
    let mut orientation = 1u32;
    if let Ok(file) = std::fs::File::open(path) {
        let mut reader = BufReader::new(file);
        if let Ok(exif) = exif::Reader::new().read_from_container(&mut reader) {
            if let Some(f) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
                if let Some(v) = f.value.get_uint(0) {
                    orientation = v;
                }
            }
            for tag in [exif::Tag::DateTimeOriginal, exif::Tag::DateTime] {
                if captured.is_none() {
                    if let Some(f) = exif.get_field(tag, exif::In::PRIMARY) {
                        if let exif::Value::Ascii(ref vec) = f.value {
                            if let Some(bytes) = vec.first() {
                                let s = String::from_utf8_lossy(bytes).to_string();
                                captured = normalize_exif_datetime(&s);
                            }
                        }
                    }
                }
            }
        }
    }
    if captured.is_none() {
        captured = std::fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%Y-%m-%dT%H:%M:%S").to_string()
            });
    }
    (captured, orientation)
}

/// "YYYY:MM:DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS"
fn normalize_exif_datetime(s: &str) -> Option<String> {
    let s = s.trim();
    if s.len() < 19 {
        return None;
    }
    let b = s.as_bytes();
    if b[4] != b':' || b[7] != b':' {
        return None;
    }
    Some(format!("{}-{}-{}T{}", &s[0..4], &s[5..7], &s[8..10], &s[11..19]))
}

fn apply_orientation(img: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn rawler_orientation_code(o: rawler::Orientation) -> u32 {
    use rawler::Orientation::*;
    match o {
        Normal => 1,
        HorizontalFlip => 2,
        Rotate180 => 3,
        VerticalFlip => 4,
        Transpose => 5,
        Rotate90 => 6,
        Transverse => 7,
        Rotate270 => 8,
        _ => 1,
    }
}

/// Decode any supported file into an upright, gamma-encoded DynamicImage.
pub fn decode_to_dynamic(path: &Path) -> Result<DynamicImage> {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if is_raw_ext(&ext) {
        let raw = rawler::decode_file(path).map_err(|e| anyhow!("RAW decode failed: {e}"))?;
        let orientation = rawler_orientation_code(raw.orientation);
        let dev = RawDevelop::default();
        let intermediate = dev
            .develop_intermediate(&raw)
            .map_err(|e| anyhow!("RAW develop failed: {e}"))?;
        let img = intermediate
            .to_dynamic_image()
            .ok_or_else(|| anyhow!("cannot convert RAW to image"))?;
        Ok(apply_orientation(img, orientation))
    } else {
        let img = image::open(path).with_context(|| format!("decode {}", path.display()))?;
        let (_, orientation) = read_exif_meta(path);
        Ok(apply_orientation(img, orientation))
    }
}

/// Decode into the linear-light working format, optionally bounded to `max_px`.
pub fn decode_base(path: &Path, max_px: Option<u32>) -> Result<ImageF32> {
    let mut img = decode_to_dynamic(path)?;
    if let Some(max) = max_px {
        if img.width() > max || img.height() > max {
            img = img.resize(max, max, image::imageops::FilterType::CatmullRom);
        }
    }
    Ok(ImageF32::from_dynamic(&img))
}

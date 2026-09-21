use std::path::{Path, PathBuf};

use anyhow::Result;
use image::ImageEncoder;

use crate::engine::decode;

pub const THUMB_SIZE: u32 = 512;

/// Deterministic FNV-1a over path + size + mtime + thumb size. SQLite reuses
/// row ids after deletes, so thumbnails must be keyed by content, not id alone.
fn content_key(photo_path: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    feed(photo_path.as_bytes());
    feed(&THUMB_SIZE.to_le_bytes());
    if let Ok(md) = std::fs::metadata(photo_path) {
        feed(&md.len().to_le_bytes());
        if let Ok(mt) = md.modified() {
            if let Ok(d) = mt.duration_since(std::time::UNIX_EPOCH) {
                feed(&d.as_secs().to_le_bytes());
            }
        }
    }
    h
}

pub fn thumb_path_for(dir: &Path, photo_id: i64, photo_path: &str) -> PathBuf {
    dir.join(format!("{photo_id}-{:016x}.jpg", content_key(photo_path)))
}

/// Remove every cached thumbnail of a photo id (all content versions + legacy name).
pub fn remove_thumbs_for(dir: &Path, photo_id: i64) {
    let _ = std::fs::remove_file(dir.join(format!("{photo_id}.jpg")));
    let prefix = format!("{photo_id}-");
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// Generate (if missing) and return the JPEG bytes of a photo thumbnail.
pub fn ensure_thumb(photo_path: &str, thumb_path: &Path) -> Result<Vec<u8>> {
    if let Ok(bytes) = std::fs::read(thumb_path) {
        return Ok(bytes);
    }
    let img = decode::decode_to_dynamic(Path::new(photo_path))?;
    let thumb = img.thumbnail(THUMB_SIZE, THUMB_SIZE).to_rgb8();
    let mut buf = Vec::new();
    let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 80);
    enc.write_image(
        thumb.as_raw(),
        thumb.width(),
        thumb.height(),
        image::ExtendedColorType::Rgb8,
    )?;
    std::fs::write(thumb_path, &buf)?;
    Ok(buf)
}

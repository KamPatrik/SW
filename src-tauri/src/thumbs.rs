use std::path::Path;

use anyhow::Result;
use image::ImageEncoder;

use crate::engine::decode;

pub const THUMB_SIZE: u32 = 384;

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

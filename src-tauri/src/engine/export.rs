use anyhow::{anyhow, Result};
use image::ImageEncoder;

use super::ImageF32;

/// Encode a display-encoded image as JPEG bytes.
pub fn encode_jpeg(img: &ImageF32, quality: u8) -> Result<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality.clamp(10, 100));
    enc.write_image(
        &rgb,
        img.width as u32,
        img.height as u32,
        image::ExtendedColorType::Rgb8,
    )
    .map_err(|e| anyhow!("jpeg encode: {e}"))?;
    Ok(buf)
}

/// Encode a display-encoded image as PNG bytes.
pub fn encode_png(img: &ImageF32) -> Result<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    let enc = image::codecs::png::PngEncoder::new(&mut buf);
    enc.write_image(
        &rgb,
        img.width as u32,
        img.height as u32,
        image::ExtendedColorType::Rgb8,
    )
    .map_err(|e| anyhow!("png encode: {e}"))?;
    Ok(buf)
}

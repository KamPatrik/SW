use anyhow::{anyhow, Result};
use image::imageops::FilterType;
use image::ImageEncoder;

use super::ImageF32;

/// Resize the final rendered image per output settings (Lanczos3).
pub fn resize_output(img: ImageF32, mode: &str, px: u32, no_enlarge: bool) -> ImageF32 {
    if mode == "none" || px == 0 {
        return img;
    }
    let (w, h) = (img.width as f32, img.height as f32);
    let scale = match mode {
        "long" => px as f32 / w.max(h),
        "short" => px as f32 / w.min(h),
        "width" => px as f32 / w,
        "height" => px as f32 / h,
        _ => 1.0,
    };
    let scale = if no_enlarge { scale.min(1.0) } else { scale };
    if (scale - 1.0).abs() < 1e-3 {
        return img;
    }
    let tw = ((w * scale).round() as u32).max(1);
    let th = ((h * scale).round() as u32).max(1);
    let (iw, ih) = (img.width as u32, img.height as u32);
    let buf = image::Rgb32FImage::from_raw(iw, ih, img.data).expect("pixel buffer size");
    let resized = image::DynamicImage::ImageRgb32F(buf)
        .resize_exact(tw, th, FilterType::Lanczos3)
        .into_rgb32f();
    ImageF32 {
        width: tw as usize,
        height: th as usize,
        data: resized.into_raw(),
    }
}

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

/// Encode as TIFF, either 8-bit or full 16-bit per channel (archival scans).
pub fn encode_tiff(img: &ImageF32, sixteen_bit: bool) -> Result<Vec<u8>> {
    let buf = image::Rgb32FImage::from_raw(img.width as u32, img.height as u32, img.data.clone())
        .ok_or_else(|| anyhow!("pixel buffer size mismatch"))?;
    let dynimg = image::DynamicImage::ImageRgb32F(buf);
    let mut cur = std::io::Cursor::new(Vec::new());
    let enc = image::codecs::tiff::TiffEncoder::new(&mut cur);
    if sixteen_bit {
        let rgb16 = dynimg.into_rgb16();
        let bytes: Vec<u8> = rgb16.as_raw().iter().flat_map(|v| v.to_ne_bytes()).collect();
        enc.write_image(&bytes, rgb16.width(), rgb16.height(), image::ExtendedColorType::Rgb16)
            .map_err(|e| anyhow!("tiff encode: {e}"))?;
    } else {
        let rgb8 = dynimg.into_rgb8();
        enc.write_image(
            rgb8.as_raw(),
            rgb8.width(),
            rgb8.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| anyhow!("tiff encode: {e}"))?;
    }
    Ok(cur.into_inner())
}

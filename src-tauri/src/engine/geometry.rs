use rayon::prelude::*;

use super::pipeline::{CropRect, Recipe};
use super::ImageF32;

pub fn apply(img: ImageF32, r: &Recipe, ignore_crop: bool) -> ImageF32 {
    apply_crop(apply_orient(img, r), r, ignore_crop)
}

/// Rotation, flips and straighten — everything except the crop.
pub fn apply_orient(img: ImageF32, r: &Recipe) -> ImageF32 {
    let mut im = img;
    match r.rotate90 % 4 {
        1 => im = rotate90(&im),
        2 => im = rotate180(&im),
        3 => im = rotate270(&im),
        _ => {}
    }
    if r.flip_h {
        im = flip_h(&im);
    }
    if r.flip_v {
        im = flip_v(&im);
    }
    if r.angle.abs() > 0.02 {
        im = rotate_fine(&im, r.angle);
    }
    im
}

pub fn apply_crop(im: ImageF32, r: &Recipe, ignore_crop: bool) -> ImageF32 {
    if !ignore_crop {
        if let Some(c) = &r.crop {
            return crop(&im, c);
        }
    }
    im
}

fn rotate90(src: &ImageF32) -> ImageF32 {
    let (w, h) = (src.width, src.height);
    let mut out = ImageF32::new(h, w);
    for y in 0..h {
        for x in 0..w {
            out.set(h - 1 - y, x, src.px(x, y));
        }
    }
    out
}

fn rotate270(src: &ImageF32) -> ImageF32 {
    let (w, h) = (src.width, src.height);
    let mut out = ImageF32::new(h, w);
    for y in 0..h {
        for x in 0..w {
            out.set(y, w - 1 - x, src.px(x, y));
        }
    }
    out
}

fn rotate180(src: &ImageF32) -> ImageF32 {
    let (w, h) = (src.width, src.height);
    let mut out = ImageF32::new(w, h);
    for y in 0..h {
        for x in 0..w {
            out.set(w - 1 - x, h - 1 - y, src.px(x, y));
        }
    }
    out
}

fn flip_h(src: &ImageF32) -> ImageF32 {
    let (w, h) = (src.width, src.height);
    let mut out = ImageF32::new(w, h);
    for y in 0..h {
        for x in 0..w {
            out.set(w - 1 - x, y, src.px(x, y));
        }
    }
    out
}

fn flip_v(src: &ImageF32) -> ImageF32 {
    let (w, h) = (src.width, src.height);
    let mut out = ImageF32::new(w, h);
    for y in 0..h {
        for x in 0..w {
            out.set(x, h - 1 - y, src.px(x, y));
        }
    }
    out
}

/// Straighten by `angle` degrees. The output is auto-cropped to the largest
/// axis-aligned rectangle that fits inside the rotated image (max area), so
/// no black corners appear — Lightroom-style constrained rotation.
fn rotate_fine(src: &ImageF32, angle_deg: f32) -> ImageF32 {
    let (w, h) = (src.width, src.height);
    let (wf, hf) = (w as f32, h as f32);
    let a = angle_deg.to_radians();
    let (sin_a, cos_a) = (a.sin().abs(), a.cos().abs());

    let (side_long, side_short) = if wf >= hf { (wf, hf) } else { (hf, wf) };
    let (cw, ch) = if side_short <= 2.0 * sin_a * cos_a * side_long || (sin_a - cos_a).abs() < 1e-5 {
        let x = 0.5 * side_short;
        if wf >= hf { (x / sin_a, x / cos_a) } else { (x / cos_a, x / sin_a) }
    } else {
        let cos_2a = cos_a * cos_a - sin_a * sin_a;
        ((wf * cos_a - hf * sin_a) / cos_2a, (hf * cos_a - wf * sin_a) / cos_2a)
    };
    let out_w = (cw.floor() as usize).clamp(8, w);
    let out_h = (ch.floor() as usize).clamp(8, h);

    let mut out = ImageF32::new(out_w, out_h);
    let (s, c) = a.sin_cos();
    let cx = (wf - 1.0) / 2.0;
    let cy = (hf - 1.0) / 2.0;
    let ox = (out_w as f32 - 1.0) / 2.0;
    let oy = (out_h as f32 - 1.0) / 2.0;
    out.data.par_chunks_mut(out_w * 3).enumerate().for_each(|(y, row)| {
        let fy = y as f32 - oy;
        for (x, px) in row.chunks_exact_mut(3).enumerate() {
            let fx = x as f32 - ox;
            // inverse rotation around the source centre
            let sx = c * fx + s * fy + cx;
            let sy = -s * fx + c * fy + cy;
            let p = src.sample_bilinear(sx, sy);
            px[0] = p[0];
            px[1] = p[1];
            px[2] = p[2];
        }
    });
    out
}

fn crop(src: &ImageF32, c: &CropRect) -> ImageF32 {
    let (w, h) = (src.width as f32, src.height as f32);
    let x0 = ((c.x * w).round() as i64).clamp(0, src.width as i64 - 1) as usize;
    let y0 = ((c.y * h).round() as i64).clamp(0, src.height as i64 - 1) as usize;
    let cw = (((c.w * w).round() as i64).max(8) as usize).min(src.width - x0);
    let ch = (((c.h * h).round() as i64).max(8) as usize).min(src.height - y0);
    let mut out = ImageF32::new(cw, ch);
    for y in 0..ch {
        let srow = ((y0 + y) * src.width + x0) * 3;
        let drow = y * cw * 3;
        out.data[drow..drow + cw * 3].copy_from_slice(&src.data[srow..srow + cw * 3]);
    }
    out
}

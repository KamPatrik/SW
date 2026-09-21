use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use super::{curve, geometry, negative, retouch, ImageF32};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NegativeParams {
    pub enabled: bool,
    /// Linear-light RGB of the unexposed film base (orange mask). None = auto.
    pub film_base: Option<[f32; 3]>,
    pub gamma: f32,
    pub red_balance: f32,
    pub blue_balance: f32,
}

impl Default for NegativeParams {
    fn default() -> Self {
        Self { enabled: false, film_base: None, gamma: 1.0, red_balance: 0.0, blue_balance: 0.0 }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Spot {
    pub x: f32,
    pub y: f32,
    /// Radius relative to image width.
    pub radius: f32,
    /// Optional stroke end point — legacy straight strokes.
    pub x2: Option<f32>,
    pub y2: Option<f32>,
    /// Optional freehand polyline (normalized coords) — healed as one region.
    pub path: Option<Vec<[f32; 2]>>,
}

impl Default for Spot {
    fn default() -> Self {
        Self { x: 0.5, y: 0.5, radius: 0.01, x2: None, y2: None, path: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Recipe {
    pub negative: NegativeParams,
    pub wb_temp: f32,
    pub wb_tint: f32,
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub vibrance: f32,
    pub saturation: f32,
    pub sharpen: f32,
    pub clarity: f32,
    pub noise: f32,
    pub vignette: f32,
    pub grain: f32,
    pub tone_curve: Vec<[f32; 2]>,
    pub rotate90: u32,
    pub flip_h: bool,
    pub flip_v: bool,
    pub angle: f32,
    pub crop: Option<CropRect>,
    pub spots: Vec<Spot>,
    pub redeye: Vec<Spot>,
}

impl Default for Recipe {
    fn default() -> Self {
        Self {
            negative: NegativeParams::default(),
            wb_temp: 0.0,
            wb_tint: 0.0,
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            vibrance: 0.0,
            saturation: 0.0,
            sharpen: 0.0,
            clarity: 0.0,
            noise: 0.0,
            vignette: 0.0,
            grain: 0.0,
            tone_curve: Vec::new(),
            rotate90: 0,
            flip_h: false,
            flip_v: false,
            angle: 0.0,
            crop: None,
            spots: Vec::new(),
            redeye: Vec::new(),
        }
    }
}

fn wb_factors(temp: f32, tint: f32) -> [f32; 3] {
    let t = temp * 0.01;
    let g = tint * 0.01;
    [
        (1.0 + 0.4 * t).clamp(0.1, 4.0),
        (1.0 - 0.3 * g).clamp(0.1, 4.0),
        (1.0 - 0.4 * t).clamp(0.1, 4.0),
    ]
}

/// Heal, red-eye, orientation, crop and negative conversion — everything
/// ahead of the tone controls. Cached between renders while only tone
/// sliders move.
pub fn prepare_stage(base: &ImageF32, r: &Recipe, ignore_crop: bool) -> ImageF32 {
    let mut img = geometry::apply_orient(base.clone(), r);
    img = retouch::heal_spots(&img, &r.spots);
    retouch::fix_redeye(&mut img, &r.redeye);
    img = geometry::apply_crop(img, r, ignore_crop);
    if r.negative.enabled {
        img = negative::convert(&img, &r.negative);
    }
    img
}

/// Run the full non-destructive recipe on a linear-light base image.
/// Returns a display-encoded (approx. sRGB gamma) image ready for RGB8 packing.
pub fn apply_recipe(base: &ImageF32, r: &Recipe, ignore_crop: bool) -> ImageF32 {
    let stage = prepare_stage(base, r, ignore_crop);
    apply_tone(&stage, r)
}

/// Tone/colour part of the pipeline: WB, exposure, curves, effects.
pub fn apply_tone(stage: &ImageF32, r: &Recipe) -> ImageF32 {
    let mut img = stage.clone();

    let wb = wb_factors(r.wb_temp, r.wb_tint);
    let exp = 2f32.powf(r.exposure);
    let lut = curve::build_lut(&r.tone_curve);
    let wp = 1.0 - r.whites * 0.0035;
    let bp = -r.blacks * 0.0035;
    let range = (wp - bp).max(0.05);
    let ck = if r.contrast >= 0.0 { 1.0 + r.contrast * 0.012 } else { 1.0 + r.contrast * 0.008 };
    let sh = r.shadows * 0.004;
    let hl = r.highlights * 0.004;
    let sat = 1.0 + r.saturation * 0.01;
    let vib = r.vibrance * 0.01;

    let w = img.width;
    img.data.par_chunks_mut(w * 3).for_each(|row| {
        for px in row.chunks_exact_mut(3) {
            let mut c = [px[0] * wb[0] * exp, px[1] * wb[1] * exp, px[2] * wb[2] * exp];
            // linear -> display gamma
            for v in c.iter_mut() {
                *v = v.max(0.0).powf(1.0 / 2.2);
            }
            // blacks / whites remap
            for v in c.iter_mut() {
                *v = (*v - bp) / range;
            }
            // shadows / highlights, luma-masked
            let l = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).clamp(0.0, 1.0);
            if sh != 0.0 {
                let wgt = (1.0 - l) * (1.0 - l);
                for v in c.iter_mut() {
                    *v += sh * wgt;
                }
            }
            if hl != 0.0 {
                let wgt = l * l;
                for v in c.iter_mut() {
                    *v += hl * wgt;
                }
            }
            // contrast around mid-grey
            if r.contrast != 0.0 {
                for v in c.iter_mut() {
                    *v = (*v - 0.5) * ck + 0.5;
                }
            }
            // tone curve
            if let Some(lut) = &lut {
                for v in c.iter_mut() {
                    *v = curve::sample_lut(lut, v.clamp(0.0, 1.0));
                }
            }
            // vibrance / saturation
            let l2 = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            let maxc = c[0].max(c[1]).max(c[2]);
            let minc = c[0].min(c[1]).min(c[2]);
            let satur = (maxc - minc).clamp(0.0, 1.0);
            let f = (sat * (1.0 + vib * (1.0 - satur))).max(0.0);
            if (f - 1.0).abs() > 1e-4 {
                for v in c.iter_mut() {
                    *v = l2 + (*v - l2) * f;
                }
            }
            px[0] = c[0].clamp(0.0, 1.0);
            px[1] = c[1].clamp(0.0, 1.0);
            px[2] = c[2].clamp(0.0, 1.0);
        }
    });

    if r.noise > 0.5 {
        denoise(&mut img, r.noise);
    }
    if r.clarity.abs() > 0.5 {
        clarity(&mut img, r.clarity);
    }
    if r.sharpen > 0.5 {
        unsharp(&mut img, r.sharpen * 0.012);
    }
    if r.vignette.abs() > 0.5 {
        vignette(&mut img, r.vignette);
    }
    if r.grain > 0.5 {
        grain(&mut img, r.grain);
    }
    img
}

/// Simple unsharp mask with a 3x3 box blur, on the display-encoded image.
fn unsharp(img: &mut ImageF32, amount: f32) {
    let w = img.width;
    let h = img.height;
    let src = img.data.clone();
    let get = |x: i64, y: i64, c: usize| -> f32 {
        let x = x.clamp(0, w as i64 - 1) as usize;
        let y = y.clamp(0, h as i64 - 1) as usize;
        src[(y * w + x) * 3 + c]
    };
    img.data.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        let y = y as i64;
        for (x, px) in row.chunks_exact_mut(3).enumerate() {
            let x = x as i64;
            for c in 0..3 {
                let mut sum = 0.0;
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        sum += get(x + dx, y + dy, c);
                    }
                }
                let blur = sum / 9.0;
                let v = px[c] + amount * (px[c] - blur);
                px[c] = v.clamp(0.0, 1.0);
            }
        }
    });
}

/// Horizontal box blur with clamped edges (O(n) sliding window per row).
fn box_blur_rows(src: &[f32], w: usize, radius: usize) -> Vec<f32> {
    let mut out = vec![0f32; src.len()];
    let r = radius.max(1).min(w.saturating_sub(1) / 2).max(1);
    let norm = 1.0 / (2 * r + 1) as f32;
    out.par_chunks_mut(w).zip(src.par_chunks(w)).for_each(|(dst, row)| {
        let at = |i: i64| row[i.clamp(0, w as i64 - 1) as usize];
        let mut acc = 0.0f32;
        for k in -(r as i64)..=(r as i64) {
            acc += at(k);
        }
        for i in 0..w {
            dst[i] = acc * norm;
            acc += at(i as i64 + r as i64 + 1) - at(i as i64 - r as i64);
        }
    });
    out
}

fn transpose(src: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut out = vec![0f32; src.len()];
    for y in 0..h {
        for x in 0..w {
            out[x * h + y] = src[y * w + x];
        }
    }
    out
}

/// Local contrast: wide-radius unsharp mask on luminance, midtone weighted.
fn clarity(img: &mut ImageF32, amount: f32) {
    let w = img.width;
    let h = img.height;
    let radius = (w.max(h) / 80).clamp(4, 40);
    let mut luma = vec![0f32; w * h];
    luma.par_chunks_mut(w).zip(img.data.par_chunks(w * 3)).for_each(|(lr, row)| {
        for (l, px) in lr.iter_mut().zip(row.chunks_exact(3)) {
            *l = 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
        }
    });
    let hpass = box_blur_rows(&luma, w, radius);
    let tr = transpose(&hpass, w, h);
    let vpass = box_blur_rows(&tr, h, radius);
    let blurred = transpose(&vpass, h, w);
    let k = amount * 0.01 * 0.9;
    img.data.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        for (x, px) in row.chunks_exact_mut(3).enumerate() {
            let l = luma[y * w + x];
            let b = blurred[y * w + x];
            let wgt = (4.0 * l * (1.0 - l)).clamp(0.0, 1.0);
            let d = (l - b) * k * wgt;
            for c in px.iter_mut() {
                *c = (*c + d).clamp(0.0, 1.0);
            }
        }
    });
}

/// Edge-preserving 5x5 bilateral smoothing guided by luminance.
fn denoise(img: &mut ImageF32, amount: f32) {
    let w = img.width;
    let h = img.height;
    let src = img.data.clone();
    let sr = 0.015 + amount * 0.0012;
    let inv2 = 1.0 / (2.0 * sr * sr);
    let blend = (amount * 0.01).clamp(0.0, 1.0);
    let luma = |i: usize| 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
    img.data.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        for (x, px) in row.chunks_exact_mut(3).enumerate() {
            let lc = luma((y * w + x) * 3);
            let mut acc = [0f32; 3];
            let mut wsum = 0f32;
            for dy in -2i64..=2 {
                let sy = (y as i64 + dy).clamp(0, h as i64 - 1) as usize;
                for dx in -2i64..=2 {
                    let sx = (x as i64 + dx).clamp(0, w as i64 - 1) as usize;
                    let si = (sy * w + sx) * 3;
                    let dl = luma(si) - lc;
                    let spatial = 1.0 / (1.0 + 0.15 * (dx * dx + dy * dy) as f32);
                    let range = 1.0 / (1.0 + dl * dl * inv2);
                    let wgt = spatial * range;
                    wsum += wgt;
                    for c in 0..3 {
                        acc[c] += src[si + c] * wgt;
                    }
                }
            }
            for c in 0..3 {
                let nv = acc[c] / wsum;
                px[c] = (px[c] + (nv - px[c]) * blend).clamp(0.0, 1.0);
            }
        }
    });
}

/// Radial exposure falloff; negative darkens corners, positive lightens.
fn vignette(img: &mut ImageF32, amount: f32) {
    let w = img.width;
    let h = img.height;
    let v = amount * 0.01;
    let cx = (w as f32 - 1.0) * 0.5;
    let cy = (h as f32 - 1.0) * 0.5;
    let inv = 1.0 / (cx * cx + cy * cy).max(1.0).sqrt();
    img.data.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        let dy = y as f32 - cy;
        for (x, px) in row.chunks_exact_mut(3).enumerate() {
            let dx = x as f32 - cx;
            let nd = (dx * dx + dy * dy).sqrt() * inv;
            let f = (1.0 + v * nd * nd * 1.5).max(0.0);
            for c in px.iter_mut() {
                *c = (*c * f).clamp(0.0, 1.0);
            }
        }
    });
}

/// Deterministic monochrome film-like grain, strongest in midtones.
fn grain(img: &mut ImageF32, amount: f32) {
    let w = img.width;
    let k = amount * 0.01 * 0.10;
    img.data.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        for (x, px) in row.chunks_exact_mut(3).enumerate() {
            let mut hsh = (x as u32)
                .wrapping_mul(374_761_393)
                .wrapping_add((y as u32).wrapping_mul(668_265_263));
            hsh = (hsh ^ (hsh >> 13)).wrapping_mul(1_274_126_177);
            let n = ((hsh ^ (hsh >> 16)) & 0xFFFF) as f32 / 32768.0 - 1.0;
            let l = 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
            let wgt = (4.0 * l * (1.0 - l)).clamp(0.15, 1.0);
            let d = n * k * wgt;
            for c in px.iter_mut() {
                *c = (*c + d).clamp(0.0, 1.0);
            }
        }
    });
}

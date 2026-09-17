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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Spot {
    pub x: f32,
    pub y: f32,
    /// Radius relative to image width.
    pub radius: f32,
}

impl Default for Spot {
    fn default() -> Self {
        Self { x: 0.5, y: 0.5, radius: 0.01 }
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
    pub tone_curve: Vec<[f32; 2]>,
    pub rotate90: u32,
    pub flip_h: bool,
    pub flip_v: bool,
    pub angle: f32,
    pub crop: Option<CropRect>,
    pub spots: Vec<Spot>,
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
            tone_curve: Vec::new(),
            rotate90: 0,
            flip_h: false,
            flip_v: false,
            angle: 0.0,
            crop: None,
            spots: Vec::new(),
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

/// Run the full non-destructive recipe on a linear-light base image.
/// Returns a display-encoded (approx. sRGB gamma) image ready for RGB8 packing.
pub fn apply_recipe(base: &ImageF32, r: &Recipe, ignore_crop: bool) -> ImageF32 {
    let mut img = retouch::heal_spots(base, &r.spots);
    img = geometry::apply(img, r, ignore_crop);
    if r.negative.enabled {
        img = negative::convert(&img, &r.negative);
    }

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

    if r.sharpen > 0.5 {
        unsharp(&mut img, r.sharpen * 0.012);
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

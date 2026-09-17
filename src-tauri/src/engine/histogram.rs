use serde::Serialize;

use super::ImageF32;

pub const BINS: usize = 128;

#[derive(Debug, Clone, Serialize)]
pub struct Histogram {
    pub r: Vec<u32>,
    pub g: Vec<u32>,
    pub b: Vec<u32>,
    pub l: Vec<u32>,
}

/// Histogram of a display-encoded image.
pub fn compute(img: &ImageF32) -> Histogram {
    let mut h = Histogram {
        r: vec![0; BINS],
        g: vec![0; BINS],
        b: vec![0; BINS],
        l: vec![0; BINS],
    };
    let npix = img.width * img.height;
    let stride = (npix / 400_000).max(1);
    let bin = |v: f32| -> usize { ((v.clamp(0.0, 1.0) * (BINS - 1) as f32) + 0.5) as usize };
    for i in (0..npix).step_by(stride) {
        let r = img.data[i * 3];
        let g = img.data[i * 3 + 1];
        let b = img.data[i * 3 + 2];
        h.r[bin(r)] += 1;
        h.g[bin(g)] += 1;
        h.b[bin(b)] += 1;
        h.l[bin(0.2126 * r + 0.7152 * g + 0.0722 * b)] += 1;
    }
    h
}

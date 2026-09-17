use rayon::prelude::*;

use super::pipeline::NegativeParams;
use super::ImageF32;

/// Density-based negative -> positive conversion (works for C-41 colour
/// negatives incl. orange mask, and for B&W).
///
/// Model: transmittance t = v / film_base per channel; density d = -log10(t).
/// The per-channel density range (percentiles) is normalized to 0..1, which
/// linearizes the film's characteristic curve well enough for a starting point.
pub fn convert(img: &ImageF32, p: &NegativeParams) -> ImageF32 {
    let base = p
        .film_base
        .map(|b| [b[0].max(1e-3), b[1].max(1e-3), b[2].max(1e-3)])
        .unwrap_or_else(|| auto_base(img));

    // sample densities per channel to find black/white points
    let npix = img.width * img.height;
    let stride = (npix / 150_000).max(1);
    let mut lo = [0.0f32; 3];
    let mut hi = [1.0f32; 3];
    for c in 0..3 {
        let mut ds: Vec<f32> = (0..npix)
            .step_by(stride)
            .map(|i| {
                let t = (img.data[i * 3 + c] / base[c]).clamp(1e-4, 4.0);
                -t.log10()
            })
            .collect();
        ds.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let pct = |v: &Vec<f32>, p: f32| -> f32 {
            let idx = ((v.len() - 1) as f32 * p / 100.0).round() as usize;
            v[idx.min(v.len() - 1)]
        };
        lo[c] = pct(&ds, 1.0);
        hi[c] = pct(&ds, 99.2);
        if hi[c] - lo[c] < 0.05 {
            hi[c] = lo[c] + 0.05;
        }
    }

    let bal = [
        1.0 + p.red_balance * 0.005,
        1.0,
        1.0 + p.blue_balance * 0.005,
    ];
    let gam = p.gamma.clamp(0.3, 3.0);

    let mut out = ImageF32::new(img.width, img.height);
    out.data
        .par_chunks_mut(4096 * 3)
        .zip(img.data.par_chunks(4096 * 3))
        .for_each(|(dst, src)| {
            for (d, s) in dst.chunks_exact_mut(3).zip(s_chunks(src)) {
                for c in 0..3 {
                    let t = (s[c] / base[c]).clamp(1e-4, 4.0);
                    let dens = -t.log10();
                    let mut n = (dens - lo[c]) / (hi[c] - lo[c]);
                    n *= bal[c];
                    n = n.clamp(0.0, 1.0).powf(gam);
                    // normalized density is display-like; return to linear light
                    d[c] = n.powf(2.2);
                }
            }
        });
    out
}

#[inline]
fn s_chunks(src: &[f32]) -> impl Iterator<Item = &[f32]> {
    src.chunks_exact(3)
}

/// Estimate the film base colour as a per-channel high percentile:
/// the unexposed base + fog is the most transparent (brightest) part of a negative.
fn auto_base(img: &ImageF32) -> [f32; 3] {
    let npix = img.width * img.height;
    let stride = (npix / 120_000).max(1);
    let mut base = [0.05f32; 3];
    for c in 0..3 {
        let mut vs: Vec<f32> = (0..npix).step_by(stride).map(|i| img.data[i * 3 + c]).collect();
        vs.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let idx = ((vs.len() - 1) as f32 * 0.997).round() as usize;
        base[c] = vs[idx.min(vs.len() - 1)].max(0.01);
    }
    base
}

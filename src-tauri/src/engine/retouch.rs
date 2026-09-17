use std::f32::consts::PI;

use super::pipeline::Spot;
use super::ImageF32;

/// Heal dust spots by cloning a nearby patch with a feathered edge.
/// The source patch direction is chosen automatically: the candidate whose
/// mean colour best matches the ring just outside the spot wins.
pub fn heal_spots(base: &ImageF32, spots: &[Spot]) -> ImageF32 {
    let mut img = base.clone();
    if spots.is_empty() {
        return img;
    }
    let src = base.clone();
    let wf = base.width as f32;
    let hf = base.height as f32;

    for s in spots {
        let r = (s.radius * wf).clamp(2.0, wf.min(hf) * 0.25);
        let cx = s.x * wf;
        let cy = s.y * hf;
        let (ox, oy) = best_source_offset(&src, cx, cy, r);

        let x0 = ((cx - r).floor() as i64).max(0) as usize;
        let x1 = ((cx + r).ceil() as i64).min(base.width as i64 - 1) as usize;
        let y0 = ((cy - r).floor() as i64).max(0) as usize;
        let y1 = ((cy + r).ceil() as i64).min(base.height as i64 - 1) as usize;

        for y in y0..=y1 {
            for x in x0..=x1 {
                let dx = x as f32 - cx;
                let dy = y as f32 - cy;
                let d = (dx * dx + dy * dy).sqrt();
                if d >= r {
                    continue;
                }
                let t = if d < r * 0.6 {
                    1.0
                } else {
                    let u = ((r - d) / (r * 0.4)).clamp(0.0, 1.0);
                    u * u * (3.0 - 2.0 * u)
                };
                let sp = src.sample_bilinear(x as f32 + ox, y as f32 + oy);
                let cur = img.px(x, y);
                img.set(
                    x,
                    y,
                    [
                        cur[0] + (sp[0] - cur[0]) * t,
                        cur[1] + (sp[1] - cur[1]) * t,
                        cur[2] + (sp[2] - cur[2]) * t,
                    ],
                );
            }
        }
    }
    img
}

fn ring_mean(img: &ImageF32, cx: f32, cy: f32, radius: f32) -> [f32; 3] {
    let mut acc = [0.0f32; 3];
    let n = 16;
    for k in 0..n {
        let a = k as f32 / n as f32 * 2.0 * PI;
        let p = img.sample_bilinear(cx + radius * a.cos(), cy + radius * a.sin());
        for c in 0..3 {
            acc[c] += p[c];
        }
    }
    [acc[0] / n as f32, acc[1] / n as f32, acc[2] / n as f32]
}

fn patch_stats(img: &ImageF32, cx: f32, cy: f32, r: f32) -> ([f32; 3], f32) {
    let mut samples: Vec<[f32; 3]> = Vec::with_capacity(17);
    samples.push(img.sample_bilinear(cx, cy));
    for ring_r in [r * 0.4, r * 0.8] {
        for k in 0..8 {
            let a = k as f32 / 8.0 * 2.0 * PI;
            samples.push(img.sample_bilinear(cx + ring_r * a.cos(), cy + ring_r * a.sin()));
        }
    }
    let mut mean = [0.0f32; 3];
    for s in &samples {
        for c in 0..3 {
            mean[c] += s[c];
        }
    }
    for c in 0..3 {
        mean[c] /= samples.len() as f32;
    }
    let mut var = 0.0;
    for s in &samples {
        for c in 0..3 {
            let d = s[c] - mean[c];
            var += d * d;
        }
    }
    (mean, var / samples.len() as f32)
}

fn best_source_offset(img: &ImageF32, cx: f32, cy: f32, r: f32) -> (f32, f32) {
    let target = ring_mean(img, cx, cy, r * 1.5);
    let dist = r * 2.6;
    let mut best = (dist, 0.0f32);
    let mut best_score = f32::MAX;
    for k in 0..8 {
        let a = k as f32 / 8.0 * 2.0 * PI;
        let ox = dist * a.cos();
        let oy = dist * a.sin();
        let px = cx + ox;
        let py = cy + oy;
        if px - r < 0.0
            || py - r < 0.0
            || px + r > img.width as f32 - 1.0
            || py + r > img.height as f32 - 1.0
        {
            continue;
        }
        let (mean, var) = patch_stats(img, px, py, r);
        let mut diff = 0.0;
        for c in 0..3 {
            let d = mean[c] - target[c];
            diff += d * d;
        }
        let score = diff + var * 0.5;
        if score < best_score {
            best_score = score;
            best = (ox, oy);
        }
    }
    best
}

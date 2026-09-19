use std::f32::consts::PI;

use super::pipeline::Spot;
use super::ImageF32;

const RING_SAMPLES: usize = 20;
const RING_MARGIN: f32 = 1.35;

/// Neutralize red-eye pupils: inside each circle, pixels whose red channel
/// clearly dominates are pulled to the green/blue average and darkened,
/// weighted by redness (soft mask) and a radial edge feather.
pub fn fix_redeye(img: &mut ImageF32, eyes: &[Spot]) {
    if eyes.is_empty() {
        return;
    }
    let wf = img.width as f32;
    let hf = img.height as f32;
    for s in eyes {
        let r = (s.radius * wf).clamp(2.0, wf.min(hf) * 0.2);
        let cx = (s.x * wf).clamp(0.0, wf - 1.0);
        let cy = (s.y * hf).clamp(0.0, hf - 1.0);
        let x0 = ((cx - r).floor() as i64).max(0) as usize;
        let x1 = ((cx + r).ceil() as i64).min(img.width as i64 - 1) as usize;
        let y0 = ((cy - r).floor() as i64).max(0) as usize;
        let y1 = ((cy + r).ceil() as i64).min(img.height as i64 - 1) as usize;
        for y in y0..=y1 {
            for x in x0..=x1 {
                let dx = x as f32 - cx;
                let dy = y as f32 - cy;
                let d = (dx * dx + dy * dy).sqrt();
                if d >= r {
                    continue;
                }
                let p = img.px(x, y);
                if p[0] < 0.02 {
                    continue;
                }
                let gb = 0.5 * (p[1] + p[2]);
                // linear-light redness: ~0.5 for skin tones, >0.8 for flash red-eye
                let redness = (p[0] - gb) / p[0].max(1e-3);
                let m = ((redness - 0.55) / 0.25).clamp(0.0, 1.0);
                if m <= 0.0 {
                    continue;
                }
                let u = ((r - d) / (r * 0.3)).clamp(0.0, 1.0);
                let t = m * u * u * (3.0 - 2.0 * u);
                let nr = p[0] + (gb - p[0]) * t;
                let dark = 1.0 - 0.25 * t;
                img.set(x, y, [nr * dark, p[1] * dark, p[2] * dark]);
            }
        }
    }
}

/// Heal dust spots and streaks (capsules) by cloning a nearby patch with a
/// feathered edge. Matching works on locally averaged ring signatures with a
/// noise-aware threshold, so film grain never forces the smooth fallback; and
/// when the fallback inpaint *is* needed (blemish on a contrast edge), the
/// donor patch's high-frequency texture is re-added — healed areas keep the
/// grain structure of the photograph.
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
        let ax = (s.x * wf).clamp(0.0, wf - 1.0);
        let ay = (s.y * hf).clamp(0.0, hf - 1.0);
        let (bx, by) = match (s.x2, s.y2) {
            (Some(x2), Some(y2)) => ((x2 * wf).clamp(0.0, wf - 1.0), (y2 * hf).clamp(0.0, hf - 1.0)),
            _ => (ax, ay),
        };
        heal_one(&mut img, &src, [ax, ay, bx, by], r);
    }
    img
}

/// Distance from a point to the segment a–b.
fn seg_dist(px: f32, py: f32, seg: [f32; 4]) -> f32 {
    let [ax, ay, bx, by] = seg;
    let dx = bx - ax;
    let dy = by - ay;
    let len2 = dx * dx + dy * dy;
    let t = if len2 <= 1e-6 {
        0.0
    } else {
        (((px - ax) * dx + (py - ay) * dy) / len2).clamp(0.0, 1.0)
    };
    let cx = ax + t * dx;
    let cy = ay + t * dy;
    ((px - cx) * (px - cx) + (py - cy) * (py - cy)).sqrt()
}

/// Evenly swept points on the hull of the capsule dilated to `radius`.
fn ring_points(seg: [f32; 4], radius: f32) -> Vec<[f32; 2]> {
    let [ax, ay, bx, by] = seg;
    let dx = bx - ax;
    let dy = by - ay;
    let mut pts = Vec::with_capacity(RING_SAMPLES);
    for k in 0..RING_SAMPLES {
        let a = k as f32 / RING_SAMPLES as f32 * 2.0 * PI;
        let (ca, sa) = (a.cos(), a.sin());
        let (anchor_x, anchor_y) = if ca * dx + sa * dy >= 0.0 { (bx, by) } else { (ax, ay) };
        pts.push([anchor_x + ca * radius, anchor_y + sa * radius]);
    }
    pts
}

/// 5-tap local mean and tap spread. The mean is a grain-robust signature for
/// pattern matching; the spread estimates the local noise (grain) level.
fn patch_sig(img: &ImageF32, x: f32, y: f32) -> ([f32; 3], f32) {
    const D: f32 = 1.4;
    let taps = [
        img.sample_bilinear(x, y),
        img.sample_bilinear(x + D, y),
        img.sample_bilinear(x - D, y),
        img.sample_bilinear(x, y + D),
        img.sample_bilinear(x, y - D),
    ];
    let mut mean = [0.0f32; 3];
    for t in &taps {
        for c in 0..3 {
            mean[c] += t[c];
        }
    }
    for c in mean.iter_mut() {
        *c /= taps.len() as f32;
    }
    let mut var = 0.0f32;
    for t in &taps {
        for c in 0..3 {
            let d = t[c] - mean[c];
            var += d * d;
        }
    }
    (mean, var / taps.len() as f32)
}

fn heal_one(img: &mut ImageF32, src: &ImageF32, seg: [f32; 4], r: f32) {
    let wf = src.width as f32;
    let hf = src.height as f32;
    let ring = ring_points(seg, r * RING_MARGIN);
    // grain-robust ring signatures + noise estimate from the tap spread
    let mut target: Vec<[f32; 3]> = Vec::with_capacity(ring.len());
    let mut noise_vars: Vec<f32> = Vec::with_capacity(ring.len());
    for p in &ring {
        let (m, v) = patch_sig(src, p[0], p[1]);
        target.push(m);
        noise_vars.push(v);
    }
    let n = target.len() as f32;
    noise_vars.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    // median: robust against the few ring points that straddle a real edge
    let noise_var = noise_vars[noise_vars.len() / 2];

    let mut t_mean = [0.0f32; 3];
    for s in &target {
        for c in 0..3 {
            t_mean[c] += s[c];
        }
    }
    for c in t_mean.iter_mut() {
        *c /= n;
    }
    let mut t_var = 0.0f32;
    for s in &target {
        for c in 0..3 {
            let d = s[c] - t_mean[c];
            t_var += d * d;
        }
    }
    t_var /= n;

    // candidate clone offsets: 8 directions x 2 distances, scored by ring-pattern SSD
    let mut best: Option<(f32, f32, f32)> = None;
    for &dist in &[r * 2.6, r * 4.2] {
        for k in 0..8 {
            let a = (k as f32 + 0.5) / 8.0 * 2.0 * PI;
            let ox = dist * a.cos();
            let oy = dist * a.sin();
            let m = r * RING_MARGIN + 1.0;
            let inb = |x: f32, y: f32| {
                x - m >= 0.0 && y - m >= 0.0 && x + m <= wf - 1.0 && y + m <= hf - 1.0
            };
            if !inb(seg[0] + ox, seg[1] + oy) || !inb(seg[2] + ox, seg[3] + oy) {
                continue;
            }
            // the shifted capsule must not overlap the blemish itself
            let mut overlaps = false;
            for i in 0..=4 {
                let t = i as f32 / 4.0;
                let sx = seg[0] + (seg[2] - seg[0]) * t + ox;
                let sy = seg[1] + (seg[3] - seg[1]) * t + oy;
                if seg_dist(sx, sy, seg) < r * 2.2 {
                    overlaps = true;
                    break;
                }
            }
            if overlaps {
                continue;
            }
            let mut ssd = 0.0f32;
            for (ts, p) in target.iter().zip(ring.iter()) {
                let (cs, _) = patch_sig(src, p[0] + ox, p[1] + oy);
                for c in 0..3 {
                    let d = ts[c] - cs[c];
                    ssd += d * d;
                }
            }
            let score = ssd / n;
            if best.map(|b| score < b.2).unwrap_or(true) {
                best = Some((ox, oy, score));
            }
        }
    }

    // texture donor for the inpaint fallback, even when the clone is rejected
    let tex_off = best.map(|(ox, oy, _)| (ox, oy));
    // accept the clone when the residual is explainable by grain noise
    let clone = match best {
        Some((ox, oy, score)) if score <= t_var * 0.6 + noise_var * 2.0 + 6e-4 => {
            let mut c_mean = [0.0f32; 3];
            for p in &ring {
                let (m, _) = patch_sig(src, p[0] + ox, p[1] + oy);
                for c in 0..3 {
                    c_mean[c] += m[c];
                }
            }
            for c in c_mean.iter_mut() {
                *c /= n;
            }
            Some((ox, oy, [t_mean[0] - c_mean[0], t_mean[1] - c_mean[1], t_mean[2] - c_mean[2]]))
        }
        _ => None,
    };

    let x0 = ((seg[0].min(seg[2]) - r).floor() as i64).max(0) as usize;
    let x1 = ((seg[0].max(seg[2]) + r).ceil() as i64).min(src.width as i64 - 1) as usize;
    let y0 = ((seg[1].min(seg[3]) - r).floor() as i64).max(0) as usize;
    let y1 = ((seg[1].max(seg[3]) + r).ceil() as i64).min(src.height as i64 - 1) as usize;

    for y in y0..=y1 {
        for x in x0..=x1 {
            let d = seg_dist(x as f32, y as f32, seg);
            if d >= r {
                continue;
            }
            let t = if d < r * 0.6 {
                1.0
            } else {
                let u = ((r - d) / (r * 0.4)).clamp(0.0, 1.0);
                u * u * (3.0 - 2.0 * u)
            };
            let val = match &clone {
                Some((ox, oy, delta)) => {
                    let p = src.sample_bilinear(x as f32 + ox, y as f32 + oy);
                    [
                        (p[0] + delta[0]).max(0.0),
                        (p[1] + delta[1]).max(0.0),
                        (p[2] + delta[2]).max(0.0),
                    ]
                }
                None => {
                    // smooth inpaint from the ring, then re-add donor texture so
                    // grain survives — never leave a polished patch
                    let mut acc = [0.0f32; 3];
                    let mut wsum = 0.0f32;
                    for (p, s) in ring.iter().zip(target.iter()) {
                        let dx = p[0] - x as f32;
                        let dy = p[1] - y as f32;
                        let w = 1.0 / (dx * dx + dy * dy + 1.0);
                        wsum += w;
                        for c in 0..3 {
                            acc[c] += s[c] * w;
                        }
                    }
                    let mut v = [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum];
                    if let Some((tox, toy)) = tex_off {
                        let sx = x as f32 + tox;
                        let sy = y as f32 + toy;
                        let s = src.sample_bilinear(sx, sy);
                        let (m, _) = patch_sig(src, sx, sy);
                        for c in 0..3 {
                            v[c] = (v[c] + (s[c] - m[c])).max(0.0);
                        }
                    }
                    v
                }
            };
            let cur = img.px(x, y);
            img.set(
                x,
                y,
                [
                    cur[0] + (val[0] - cur[0]) * t,
                    cur[1] + (val[1] - cur[1]) * t,
                    cur[2] + (val[2] - cur[2]) * t,
                ],
            );
        }
    }
}


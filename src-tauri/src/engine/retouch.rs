use std::f32::consts::PI;

use rayon::prelude::*;

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

/// Heal dust spots and streaks (capsules) with seamless cloning: a donor
/// patch is chosen by zero-mean structural matching of a sampling ring, its
/// texture is copied verbatim, and the low-frequency mismatch is bridged by a
/// harmonic membrane interpolated with mean-value coordinates over the
/// boundary (Pérez 2003 Poisson image editing / Farbman 2009 MVC cloning —
/// the mathematics behind Photoshop's Healing Brush). Colours and gradients
/// adapt to every side of the blemish, grain is preserved, and no flat patch
/// or seam remains.
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
        let cl = |q: &[f32; 2]| [(q[0] * wf).clamp(0.0, wf - 1.0), (q[1] * hf).clamp(0.0, hf - 1.0)];
        let pts: Vec<[f32; 2]> = match &s.path {
            Some(p) if p.len() >= 2 => p.iter().map(cl).collect(),
            _ => {
                let a = cl(&[s.x, s.y]);
                match (s.x2, s.y2) {
                    (Some(x2), Some(y2)) => vec![a, cl(&[x2, y2])],
                    _ => vec![a],
                }
            }
        };
        heal_one(&mut img, &src, &pts, r);
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

/// Distance from a point to a polyline.
fn path_dist(px: f32, py: f32, pts: &[[f32; 2]]) -> f32 {
    if pts.len() < 2 {
        let dx = px - pts[0][0];
        let dy = py - pts[0][1];
        return (dx * dx + dy * dy).sqrt();
    }
    let mut d = f32::MAX;
    for w in pts.windows(2) {
        d = d.min(seg_dist(px, py, [w[0][0], w[0][1], w[1][0], w[1][1]]));
    }
    d
}

fn circle_points(c: [f32; 2], radius: f32, count: usize) -> Vec<[f32; 2]> {
    (0..count)
        .map(|k| {
            let a = k as f32 / count as f32 * 2.0 * PI;
            [c[0] + radius * a.cos(), c[1] + radius * a.sin()]
        })
        .collect()
}

/// Closed outline polygon of a stroked polyline: left side, end cap, right
/// side, start cap. Ordered, suitable for mean-value coordinates.
fn outline_points(pts: &[[f32; 2]], radius: f32) -> Vec<[f32; 2]> {
    if pts.len() < 2 {
        return circle_points(pts[0], radius, 28);
    }
    let n = pts.len();
    let mut normals: Vec<[f32; 2]> = Vec::with_capacity(n);
    for i in 0..n {
        let (ax, ay) = if i == 0 {
            (pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        } else if i == n - 1 {
            (pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1])
        } else {
            (pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1])
        };
        let l = (ax * ax + ay * ay).sqrt().max(1e-4);
        normals.push([-ay / l, ax / l]);
    }
    let cap = 6usize;
    let mut out: Vec<[f32; 2]> = Vec::with_capacity(2 * n + 2 * cap);
    for i in 0..n {
        out.push([pts[i][0] + normals[i][0] * radius, pts[i][1] + normals[i][1] * radius]);
    }
    let en = normals[n - 1];
    let base = en[1].atan2(en[0]);
    for k in 1..cap {
        let th = base - PI * k as f32 / cap as f32;
        out.push([pts[n - 1][0] + radius * th.cos(), pts[n - 1][1] + radius * th.sin()]);
    }
    for i in (0..n).rev() {
        out.push([pts[i][0] - normals[i][0] * radius, pts[i][1] - normals[i][1] * radius]);
    }
    let sn = normals[0];
    let base2 = (-sn[1]).atan2(-sn[0]);
    for k in 1..cap {
        let th = base2 - PI * k as f32 / cap as f32;
        out.push([pts[0][0] + radius * th.cos(), pts[0][1] + radius * th.sin()]);
    }
    out
}

fn subsample(pts: &[[f32; 2]], max: usize) -> Vec<[f32; 2]> {
    if pts.len() <= max {
        return pts.to_vec();
    }
    let step = pts.len() as f32 / max as f32;
    (0..max).map(|i| pts[((i as f32 * step) as usize).min(pts.len() - 1)]).collect()
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

fn heal_one(img: &mut ImageF32, src: &ImageF32, pts: &[[f32; 2]], r: f32) {
    let wf = src.width as f32;
    let hf = src.height as f32;

    // --- donor search: zero-mean structural match of ring signatures; the
    // membrane below absorbs any colour / low-frequency difference, so only
    // texture and edge continuation matter here ---
    let match_ring = subsample(&outline_points(pts, r * RING_MARGIN), RING_SAMPLES);
    let mut target: Vec<[f32; 3]> = Vec::with_capacity(match_ring.len());
    let mut noise_vars: Vec<f32> = Vec::with_capacity(match_ring.len());
    for p in &match_ring {
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

    // bbox of the matching ring, used for the candidate in-bounds test
    let mut bb = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    for p in &match_ring {
        bb[0] = bb[0].min(p[0]);
        bb[1] = bb[1].min(p[1]);
        bb[2] = bb[2].max(p[0]);
        bb[3] = bb[3].max(p[1]);
    }
    // evenly sampled path points for the donor overlap test
    let ov_pts: Vec<[f32; 2]> = subsample(pts, 8);

    // 12 directions x 3 distances
    let mut best: Option<(f32, f32, f32)> = None;
    for &dist in &[r * 2.2, r * 3.2, r * 4.5] {
        for k in 0..12 {
            let a = (k as f32 + 0.5) / 12.0 * 2.0 * PI;
            let ox = dist * a.cos();
            let oy = dist * a.sin();
            if bb[0] + ox < 1.0
                || bb[1] + oy < 1.0
                || bb[2] + ox > wf - 2.0
                || bb[3] + oy > hf - 2.0
            {
                continue;
            }
            // the shifted region must not overlap the blemish itself
            let overlaps = ov_pts
                .iter()
                .any(|p| path_dist(p[0] + ox, p[1] + oy, pts) < r * 2.0);
            if overlaps {
                continue;
            }
            let mut c_sigs: Vec<[f32; 3]> = Vec::with_capacity(match_ring.len());
            let mut c_mean = [0.0f32; 3];
            for p in &match_ring {
                let (cm, _) = patch_sig(src, p[0] + ox, p[1] + oy);
                for c in 0..3 {
                    c_mean[c] += cm[c];
                }
                c_sigs.push(cm);
            }
            for c in c_mean.iter_mut() {
                *c /= n;
            }
            let mut ssd = 0.0f32;
            for (ts, cs) in target.iter().zip(c_sigs.iter()) {
                for c in 0..3 {
                    let d = (ts[c] - t_mean[c]) - (cs[c] - c_mean[c]);
                    ssd += d * d;
                }
            }
            let score = ssd / n;
            if best.map(|b| score < b.2).unwrap_or(true) {
                best = Some((ox, oy, score));
            }
        }
    }

    // structure must match; the membrane fixes everything low-frequency
    let donor = match best {
        Some((ox, oy, score)) if score <= t_var * 0.9 + noise_var * 3.0 + 1e-3 => Some((ox, oy)),
        _ => None,
    };
    let tex_off = best.map(|(ox, oy, _)| (ox, oy));

    // --- membrane boundary: image values just outside the blemish, minus the
    // donor there (Dirichlet boundary condition of the harmonic membrane) ---
    let boundary = subsample(&outline_points(pts, r + 1.0), 120);
    let deltas: Vec<[f32; 3]> = boundary
        .iter()
        .map(|p| {
            let bx = p[0].clamp(0.0, wf - 1.0);
            let by = p[1].clamp(0.0, hf - 1.0);
            let outside = img.sample_bilinear(bx, by);
            match donor {
                Some((ox, oy)) => {
                    let dnr = src.sample_bilinear(
                        (bx + ox).clamp(0.0, wf - 1.0),
                        (by + oy).clamp(0.0, hf - 1.0),
                    );
                    [outside[0] - dnr[0], outside[1] - dnr[1], outside[2] - dnr[2]]
                }
                None => outside,
            }
        })
        .collect();

    let mut pb = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    for p in pts {
        pb[0] = pb[0].min(p[0]);
        pb[1] = pb[1].min(p[1]);
        pb[2] = pb[2].max(p[0]);
        pb[3] = pb[3].max(p[1]);
    }
    let x0 = ((pb[0] - r).floor() as i64).max(0) as usize;
    let x1 = ((pb[2] + r).ceil() as i64).min(src.width as i64 - 1) as usize;
    let y0 = ((pb[1] - r).floor() as i64).max(0) as usize;
    let y1 = ((pb[3] + r).ceil() as i64).min(src.height as i64 - 1) as usize;

    let w = img.width;
    img.data.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
        if y < y0 || y > y1 {
            return;
        }
        let py = y as f32;
        let kn = boundary.len();
        for x in x0..=x1 {
            let px = x as f32;
            let d = path_dist(px, py, pts);
            if d >= r {
                continue;
            }

            // mean-value coordinates of the pixel w.r.t. the boundary polygon
            let mut tans = [0.0f32; 160];
            let mut snap: Option<usize> = None;
            for i in 0..kn {
                let j = if i + 1 == kn { 0 } else { i + 1 };
                let ux = boundary[i][0] - px;
                let uy = boundary[i][1] - py;
                let vx = boundary[j][0] - px;
                let vy = boundary[j][1] - py;
                let lu = (ux * ux + uy * uy).sqrt();
                let lv = (vx * vx + vy * vy).sqrt();
                if lu < 0.8 {
                    snap = Some(i);
                    break;
                }
                let dot = ux * vx + uy * vy;
                let cross = (ux * vy - uy * vx).abs().max(1e-6);
                // tan(θ/2) = (|u||v| − u·v) / |u×v|
                tans[i] = ((lu * lv - dot) / cross).max(0.0);
            }
            let membrane = if let Some(i) = snap {
                deltas[i]
            } else {
                let mut acc = [0.0f32; 3];
                let mut wsum = 1e-9f32;
                for i in 0..kn {
                    let prev = if i == 0 { kn - 1 } else { i - 1 };
                    let ux = boundary[i][0] - px;
                    let uy = boundary[i][1] - py;
                    let lu = (ux * ux + uy * uy).sqrt().max(1e-4);
                    let wgt = (tans[prev] + tans[i]) / lu;
                    wsum += wgt;
                    for c in 0..3 {
                        acc[c] += deltas[i][c] * wgt;
                    }
                }
                [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum]
            };

            let val = match donor {
                Some((ox, oy)) => {
                    // donor texture + harmonic membrane = seamless clone
                    let s = src.sample_bilinear(px + ox, py + oy);
                    [
                        (s[0] + membrane[0]).max(0.0),
                        (s[1] + membrane[1]).max(0.0),
                        (s[2] + membrane[2]).max(0.0),
                    ]
                }
                None => {
                    // harmonic fill of the boundary + donor high-frequency so
                    // grain survives even without a structural match
                    let mut v = membrane;
                    if let Some((tox, toy)) = tex_off {
                        let sx = px + tox;
                        let sy = py + toy;
                        let s = src.sample_bilinear(sx, sy);
                        let (m, _) = patch_sig(src, sx, sy);
                        for c in 0..3 {
                            v[c] = (v[c] + (s[c] - m[c])).max(0.0);
                        }
                    }
                    v
                }
            };

            // thin feather hides the boundary discretisation
            let t = ((r - d) / 1.5).clamp(0.0, 1.0);
            let t = t * t * (3.0 - 2.0 * t);
            let i = x * 3;
            row[i] += (val[0] - row[i]) * t;
            row[i + 1] += (val[1] - row[i + 1]) * t;
            row[i + 2] += (val[2] - row[i + 2]) * t;
        }
    });
}


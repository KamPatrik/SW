/// Monotone cubic interpolation (Fritsch–Carlson) of tone-curve control
/// points, baked into a 256-entry LUT.
pub fn build_lut(points: &[[f32; 2]]) -> Option<Vec<f32>> {
    if points.len() < 2 {
        return None;
    }
    let mut pts: Vec<[f32; 2]> = points.to_vec();
    pts.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap_or(std::cmp::Ordering::Equal));
    pts.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-4);
    if pts.len() < 2 {
        return None;
    }
    // identity curve -> skip work
    if pts.len() == 2
        && pts[0][0].abs() < 1e-4
        && pts[0][1].abs() < 1e-4
        && (pts[1][0] - 1.0).abs() < 1e-4
        && (pts[1][1] - 1.0).abs() < 1e-4
    {
        return None;
    }

    let n = pts.len();
    let mut dx = vec![0.0f32; n - 1];
    let mut slope = vec![0.0f32; n - 1];
    for i in 0..n - 1 {
        dx[i] = (pts[i + 1][0] - pts[i][0]).max(1e-6);
        slope[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
    }
    let mut m = vec![0.0f32; n];
    m[0] = slope[0];
    m[n - 1] = slope[n - 2];
    for i in 1..n - 1 {
        if slope[i - 1] * slope[i] <= 0.0 {
            m[i] = 0.0;
        } else {
            let w1 = 2.0 * dx[i] + dx[i - 1];
            let w2 = dx[i] + 2.0 * dx[i - 1];
            m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
        }
    }

    let mut lut = vec![0.0f32; 256];
    let mut seg = 0usize;
    for (j, item) in lut.iter_mut().enumerate() {
        let x = j as f32 / 255.0;
        while seg < n - 2 && x > pts[seg + 1][0] {
            seg += 1;
        }
        let x0 = pts[seg][0];
        let y0 = pts[seg][1];
        let y1 = pts[seg + 1][1];
        let hseg = dx[seg];
        let t = ((x - x0) / hseg).clamp(0.0, 1.0);
        let t2 = t * t;
        let t3 = t2 * t;
        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;
        let y = h00 * y0 + h10 * hseg * m[seg] + h01 * y1 + h11 * hseg * m[seg + 1];
        *item = y.clamp(0.0, 1.0);
    }
    Some(lut)
}

#[inline]
pub fn sample_lut(lut: &[f32], v: f32) -> f32 {
    let f = v * 255.0;
    let i = (f.floor() as usize).min(254);
    let frac = f - i as f32;
    lut[i] + (lut[i + 1] - lut[i]) * frac
}

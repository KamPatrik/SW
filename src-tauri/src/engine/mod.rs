pub mod curve;
pub mod decode;
pub mod export;
pub mod geometry;
pub mod histogram;
pub mod negative;
pub mod pipeline;
pub mod retouch;

/// Interleaved RGB f32 image, linear light, values nominally 0..1.
#[derive(Clone)]
pub struct ImageF32 {
    pub width: usize,
    pub height: usize,
    pub data: Vec<f32>,
}

impl ImageF32 {
    pub fn new(width: usize, height: usize) -> Self {
        Self { width, height, data: vec![0.0; width * height * 3] }
    }

    #[inline]
    pub fn px(&self, x: usize, y: usize) -> [f32; 3] {
        let i = (y * self.width + x) * 3;
        [self.data[i], self.data[i + 1], self.data[i + 2]]
    }

    #[inline]
    pub fn set(&mut self, x: usize, y: usize, p: [f32; 3]) {
        let i = (y * self.width + x) * 3;
        self.data[i] = p[0];
        self.data[i + 1] = p[1];
        self.data[i + 2] = p[2];
    }

    /// Bilinear sample with edge clamping.
    pub fn sample_bilinear(&self, fx: f32, fy: f32) -> [f32; 3] {
        let maxx = (self.width - 1) as f32;
        let maxy = (self.height - 1) as f32;
        let fx = fx.clamp(0.0, maxx);
        let fy = fy.clamp(0.0, maxy);
        let x0 = fx.floor() as usize;
        let y0 = fy.floor() as usize;
        let x1 = (x0 + 1).min(self.width - 1);
        let y1 = (y0 + 1).min(self.height - 1);
        let tx = fx - x0 as f32;
        let ty = fy - y0 as f32;
        let a = self.px(x0, y0);
        let b = self.px(x1, y0);
        let c = self.px(x0, y1);
        let d = self.px(x1, y1);
        let mut out = [0.0f32; 3];
        for i in 0..3 {
            let top = a[i] + (b[i] - a[i]) * tx;
            let bot = c[i] + (d[i] - c[i]) * tx;
            out[i] = top + (bot - top) * ty;
        }
        out
    }

    /// Convert a decoded (gamma-encoded) DynamicImage into linear light.
    pub fn from_dynamic(img: &image::DynamicImage) -> Self {
        let rgb = img.to_rgb32f();
        let (w, h) = (rgb.width() as usize, rgb.height() as usize);
        let mut data = rgb.into_raw();
        use rayon::prelude::*;
        data.par_chunks_mut(4096).for_each(|chunk| {
            for v in chunk.iter_mut() {
                *v = srgb_to_linear(v.clamp(0.0, 1.0));
            }
        });
        Self { width: w, height: h, data }
    }

    /// Interpret current contents as display-encoded (0..1) and pack to RGB8.
    pub fn to_rgb8(&self) -> Vec<u8> {
        self.data
            .iter()
            .map(|v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
            .collect()
    }
}

#[inline]
pub fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

#[inline]
pub fn linear_to_srgb(v: f32) -> f32 {
    let v = v.max(0.0);
    if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

use std::collections::HashMap;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::catalog::Catalog;
use crate::engine::{decode, ImageF32};

/// Longest edge of the cached develop-preview base image.
pub const PREVIEW_MAX: u32 = 2560;

pub struct PreviewCache {
    map: HashMap<i64, Arc<ImageF32>>,
    order: VecDeque<i64>,
    cap: usize,
}

impl PreviewCache {
    pub fn new(cap: usize) -> Self {
        Self { map: HashMap::new(), order: VecDeque::new(), cap }
    }

    pub fn get(&self, id: i64) -> Option<Arc<ImageF32>> {
        self.map.get(&id).cloned()
    }

    pub fn insert(&mut self, id: i64, img: Arc<ImageF32>) {
        if self.map.insert(id, img).is_none() {
            self.order.push_back(id);
        }
        while self.order.len() > self.cap {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            }
        }
    }
}

/// Fetch the linear-light preview base for a photo, decoding on miss.
pub fn base_for(cache: &Arc<Mutex<PreviewCache>>, id: i64, path: &str) -> Result<Arc<ImageF32>, String> {
    if let Some(img) = cache.lock().map_err(|_| "cache lock")?.get(id) {
        return Ok(img);
    }
    let img = Arc::new(decode::decode_base(Path::new(path), Some(PREVIEW_MAX)).map_err(|e| e.to_string())?);
    cache.lock().map_err(|_| "cache lock")?.insert(id, img.clone());
    Ok(img)
}

pub struct AppState {
    pub catalog: Arc<Mutex<Catalog>>,
    pub cache: Arc<Mutex<PreviewCache>>,
    pub thumbs_dir: PathBuf,
}

impl AppState {
    pub fn new(catalog: Catalog, thumbs_dir: PathBuf) -> Self {
        Self {
            catalog: Arc::new(Mutex::new(catalog)),
            cache: Arc::new(Mutex::new(PreviewCache::new(3))),
            thumbs_dir,
        }
    }
}

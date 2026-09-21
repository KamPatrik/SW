use std::collections::HashMap;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::catalog::Catalog;
use crate::engine::{decode, ImageF32};

/// Longest edge of the cached develop-preview base image.
pub const PREVIEW_MAX: u32 = 2560;

pub struct PreviewCache {
    // path stored with each entry: row ids are reused by SQLite after deletes
    map: HashMap<i64, (String, Arc<ImageF32>)>,
    order: VecDeque<i64>,
    cap: usize,
}

impl PreviewCache {
    pub fn new(cap: usize) -> Self {
        Self { map: HashMap::new(), order: VecDeque::new(), cap }
    }

    pub fn get(&self, id: i64, path: &str) -> Option<Arc<ImageF32>> {
        self.map
            .get(&id)
            .filter(|(p, _)| p == path)
            .map(|(_, img)| img.clone())
    }

    pub fn insert(&mut self, id: i64, path: &str, img: Arc<ImageF32>) {
        if self.map.insert(id, (path.to_string(), img)).is_none() {
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
    if let Some(img) = cache.lock().map_err(|_| "cache lock")?.get(id, path) {
        return Ok(img);
    }
    let img = Arc::new(decode::decode_base(Path::new(path), Some(PREVIEW_MAX)).map_err(|e| e.to_string())?);
    cache.lock().map_err(|_| "cache lock")?.insert(id, path, img.clone());
    Ok(img)
}

/// Post-retouch/geometry/negative intermediate, reused while only tone
/// sliders change (they are the hot path when dragging).
pub struct StageEntry {
    pub photo_id: i64,
    pub key: u64,
    pub img: Arc<ImageF32>,
}

pub struct AppState {
    pub catalog: Arc<Mutex<Catalog>>,
    pub cache: Arc<Mutex<PreviewCache>>,
    pub stage_cache: Arc<Mutex<Option<StageEntry>>>,
    pub thumbs_dir: PathBuf,
}

impl AppState {
    pub fn new(catalog: Catalog, thumbs_dir: PathBuf) -> Self {
        Self {
            catalog: Arc::new(Mutex::new(catalog)),
            cache: Arc::new(Mutex::new(PreviewCache::new(4))),
            stage_cache: Arc::new(Mutex::new(None)),
            thumbs_dir,
        }
    }
}

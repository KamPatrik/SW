use std::path::{Path, PathBuf};

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: i64,
    pub folder_id: i64,
    pub path: String,
    pub filename: String,
    pub ext: String,
    pub is_raw: bool,
    pub rating: i64,
    pub flag: i64,
    pub color_label: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub captured_at: Option<String>,
    pub has_edits: bool,
    pub tags: Vec<String>,
    pub dup_group: Option<i64>,
    pub dup_best: bool,
}

pub struct Catalog {
    conn: Connection,
}

impl Catalog {
    pub fn open(path: PathBuf) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS folders(
                id INTEGER PRIMARY KEY,
                path TEXT UNIQUE NOT NULL
            );
            CREATE TABLE IF NOT EXISTS photos(
                id INTEGER PRIMARY KEY,
                folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                path TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,
                ext TEXT NOT NULL,
                is_raw INTEGER NOT NULL DEFAULT 0,
                rating INTEGER NOT NULL DEFAULT 0,
                flag INTEGER NOT NULL DEFAULT 0,
                color_label TEXT,
                width INTEGER,
                height INTEGER,
                captured_at TEXT,
                imported_at TEXT NOT NULL,
                edits TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_photos_folder ON photos(folder_id);
            CREATE TABLE IF NOT EXISTS tags(
                id INTEGER PRIMARY KEY,
                name TEXT UNIQUE NOT NULL
            );
            CREATE TABLE IF NOT EXISTS photo_tags(
                photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY(photo_id, tag_id)
            );
            CREATE TABLE IF NOT EXISTS presets(
                id INTEGER PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                recipe TEXT NOT NULL
            );",
        )?;
        // additive migrations; errors mean the column already exists
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN dup_group INTEGER", []);
        let _ = conn.execute("ALTER TABLE photos ADD COLUMN dup_best INTEGER NOT NULL DEFAULT 0", []);
        Ok(Self { conn })
    }

    pub fn upsert_folder(&self, path: &str) -> Result<i64> {
        self.conn
            .execute("INSERT OR IGNORE INTO folders(path) VALUES (?1)", params![path])?;
        let id = self
            .conn
            .query_row("SELECT id FROM folders WHERE path = ?1", params![path], |r| r.get(0))?;
        Ok(id)
    }

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self.conn.prepare("SELECT id, path FROM folders ORDER BY path")?;
        let rows = stmt.query_map([], |r| Ok(Folder { id: r.get(0)?, path: r.get(1)? }))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn remove_folder(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_photo(
        &self,
        folder_id: i64,
        path: &Path,
        ext: &str,
        is_raw: bool,
        width: Option<u32>,
        height: Option<u32>,
        captured_at: Option<String>,
    ) -> Result<bool> {
        let filename = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO photos(folder_id, path, filename, ext, is_raw, width, height, captured_at, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                folder_id,
                path.to_string_lossy(),
                filename,
                ext,
                is_raw,
                width,
                height,
                captured_at,
                now
            ],
        )?;
        Ok(n > 0)
    }

    pub fn list_photos(&self, folder_id: Option<i64>) -> Result<Vec<Photo>> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.folder_id, p.path, p.filename, p.ext, p.is_raw, p.rating, p.flag,
                    p.color_label, p.width, p.height, p.captured_at,
                    (p.edits IS NOT NULL) AS has_edits,
                    (SELECT group_concat(t.name, char(31))
                       FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
                      WHERE pt.photo_id = p.id) AS tag_list,
                    p.dup_group, p.dup_best
               FROM photos p
              WHERE (?1 IS NULL OR p.folder_id = ?1)
              ORDER BY p.captured_at IS NULL, p.captured_at, p.filename",
        )?;
        let rows = stmt.query_map(params![folder_id], |r| {
            let tag_list: Option<String> = r.get(13)?;
            Ok(Photo {
                id: r.get(0)?,
                folder_id: r.get(1)?,
                path: r.get(2)?,
                filename: r.get(3)?,
                ext: r.get(4)?,
                is_raw: r.get(5)?,
                rating: r.get(6)?,
                flag: r.get(7)?,
                color_label: r.get(8)?,
                width: r.get(9)?,
                height: r.get(10)?,
                captured_at: r.get(11)?,
                has_edits: r.get(12)?,
                tags: tag_list
                    .map(|s| s.split('\u{1f}').map(|t| t.to_string()).collect())
                    .unwrap_or_default(),
                dup_group: r.get(14)?,
                dup_best: r.get(15)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn photo_path(&self, id: i64) -> Result<String> {
        Ok(self
            .conn
            .query_row("SELECT path FROM photos WHERE id = ?1", params![id], |r| r.get(0))?)
    }

    pub fn photo_filename(&self, id: i64) -> Result<String> {
        Ok(self
            .conn
            .query_row("SELECT filename FROM photos WHERE id = ?1", params![id], |r| r.get(0))?)
    }

    pub fn set_rating(&self, id: i64, rating: i64) -> Result<()> {
        self.conn
            .execute("UPDATE photos SET rating = ?2 WHERE id = ?1", params![id, rating.clamp(0, 5)])?;
        Ok(())
    }

    pub fn set_flag(&self, id: i64, flag: i64) -> Result<()> {
        self.conn
            .execute("UPDATE photos SET flag = ?2 WHERE id = ?1", params![id, flag.clamp(0, 2)])?;
        Ok(())
    }

    pub fn set_color_label(&self, id: i64, label: Option<String>) -> Result<()> {
        self.conn
            .execute("UPDATE photos SET color_label = ?2 WHERE id = ?1", params![id, label])?;
        Ok(())
    }

    pub fn save_edits(&self, id: i64, recipe_json: &str) -> Result<()> {
        self.conn
            .execute("UPDATE photos SET edits = ?2 WHERE id = ?1", params![id, recipe_json])?;
        Ok(())
    }

    pub fn get_edits(&self, id: i64) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT edits FROM photos WHERE id = ?1", params![id], |r| r.get(0))?)
    }

    pub fn set_tags(&self, id: i64, tags: &[String]) -> Result<()> {
        self.conn
            .execute("DELETE FROM photo_tags WHERE photo_id = ?1", params![id])?;
        for tag in tags {
            let tag = tag.trim();
            if tag.is_empty() {
                continue;
            }
            self.conn
                .execute("INSERT OR IGNORE INTO tags(name) VALUES (?1)", params![tag])?;
            let tag_id: i64 =
                self.conn
                    .query_row("SELECT id FROM tags WHERE name = ?1", params![tag], |r| r.get(0))?;
            self.conn.execute(
                "INSERT OR IGNORE INTO photo_tags(photo_id, tag_id) VALUES (?1, ?2)",
                params![id, tag_id],
            )?;
        }
        Ok(())
    }

    pub fn rename_photo(&self, id: i64, new_path: &str, new_filename: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE photos SET path = ?2, filename = ?3 WHERE id = ?1",
            params![id, new_path, new_filename],
        )?;
        Ok(())
    }

    pub fn remove_photos(&self, ids: &[i64]) -> Result<()> {
        for id in ids {
            self.conn.execute("DELETE FROM photos WHERE id = ?1", params![id])?;
        }
        Ok(())
    }

    pub fn clear_dups(&self, folder_id: Option<i64>) -> Result<()> {
        self.conn.execute(
            "UPDATE photos SET dup_group = NULL, dup_best = 0
              WHERE (?1 IS NULL OR folder_id = ?1)",
            params![folder_id],
        )?;
        Ok(())
    }

    pub fn set_dup(&self, id: i64, group: i64, best: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE photos SET dup_group = ?2, dup_best = ?3 WHERE id = ?1",
            params![id, group, best],
        )?;
        Ok(())
    }

    pub fn list_presets(&self) -> Result<Vec<Preset>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM presets ORDER BY name")?;
        let rows = stmt.query_map([], |r| Ok(Preset { id: r.get(0)?, name: r.get(1)? }))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn save_preset(&self, name: &str, recipe_json: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO presets(name, recipe) VALUES (?1, ?2)
             ON CONFLICT(name) DO UPDATE SET recipe = excluded.recipe",
            params![name, recipe_json],
        )?;
        let id = self
            .conn
            .query_row("SELECT id FROM presets WHERE name = ?1", params![name], |r| r.get(0))?;
        Ok(id)
    }

    pub fn delete_preset(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM presets WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_preset(&self, id: i64) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT recipe FROM presets WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?)
    }
}

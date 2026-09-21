mod catalog;
mod commands;
mod engine;
mod state;
mod thumbs;

use std::path::PathBuf;
use std::sync::OnceLock;

use state::AppState;
use tauri::Manager;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Append a timestamped line to revela.log in the app data dir (best effort).
pub fn log_line(kind: &str, msg: &str) {
    if let Some(path) = LOG_PATH.get() {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(f, "[{ts}] {kind}: {msg}");
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            // error log with a simple size cap
            let log_path = data_dir.join("revela.log");
            if std::fs::metadata(&log_path).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
                let _ = std::fs::rename(&log_path, data_dir.join("revela.log.old"));
            }
            let _ = LOG_PATH.set(log_path);
            let prev_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                log_line("PANIC", &info.to_string());
                prev_hook(info);
            }));
            log_line("INFO", concat!("Revela ", env!("CARGO_PKG_VERSION"), " started"));

            let thumbs_dir = data_dir.join("thumbs");
            std::fs::create_dir_all(&thumbs_dir)?;
            let catalog = catalog::Catalog::open(data_dir.join("catalog.sqlite"))?;
            app.manage(AppState::new(catalog, thumbs_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_folder,
            commands::list_folders,
            commands::remove_folder,
            commands::list_photos,
            commands::get_thumbnail,
            commands::render_preview,
            commands::sample_base_color,
            commands::set_rating,
            commands::set_flag,
            commands::set_color_label,
            commands::set_tags,
            commands::save_edits,
            commands::get_edits,
            commands::export_photo,
            commands::rename_photo,
            commands::list_presets,
            commands::save_preset,
            commands::delete_preset,
            commands::get_preset,
            commands::sample_wb_color,
            commands::get_exif,
            commands::remove_photos,
            commands::find_duplicates,
            commands::clear_duplicates,
            commands::prefetch_photo,
            commands::open_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Revela");
}

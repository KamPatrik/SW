mod catalog;
mod commands;
mod engine;
mod state;
mod thumbs;

use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Revela");
}

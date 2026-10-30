#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .manage(sile::commands::AppState::new())
        .invoke_handler(tauri::generate_handler![
            // sites
            sile::commands::site_list,
            sile::commands::site_save,
            sile::commands::site_delete,
            sile::commands::site_get_password,
            // sessions
            sile::commands::connect,
            sile::commands::disconnect,
            // remote fs
            sile::commands::list_dir,
            sile::commands::list_local_dir,
            sile::commands::local_home,
            sile::commands::remote_home,
            sile::commands::mkdir_remote,
            sile::commands::mkdir_local,
            sile::commands::remove_remote,
            sile::commands::remove_local,
            sile::commands::rename_remote,
            sile::commands::rename_local,
            sile::commands::set_permissions,
            sile::commands::read_text_remote,
            sile::commands::write_text_remote,
            sile::commands::read_text_local,
            sile::commands::write_text_local,
            sile::commands::search_remote,
            sile::commands::remote_stat,
            sile::commands::local_stat,
            // transfers
            sile::commands::start_download,
            sile::commands::start_upload,
            sile::commands::start_copy_local,
            sile::commands::abort_transfer,
            // terminal
            sile::commands::terminal_open,
            sile::commands::terminal_write,
            sile::commands::terminal_resize,
            sile::commands::terminal_close,
            // utils
            sile::commands::preview_prepare,
            sile::commands::preview_fetch_remote,
            sile::commands::dir_size_local,
            sile::commands::dir_size_remote,
            sile::commands::file_checksum,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

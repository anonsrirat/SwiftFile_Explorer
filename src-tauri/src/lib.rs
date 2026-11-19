//! SwiftSFTP Explorer — Tauri application entry point.
//!
//! Rust owns SSH, SFTP, scheduling and security. The webview only renders UI
//! and calls the commands defined in `commands.rs`.

pub mod commands;
pub mod db;
pub mod error;
pub mod events;
pub mod remote_path;
pub mod secrets;
pub mod settings;
pub mod sftp;
pub mod ssh;
pub mod transfer;

use db::Db;
use parking_lot::RwLock;
use settings::Settings;
use sftp::SessionManager;
use ssh::SshManager;
use std::sync::Arc;
use tauri::Manager;
use transfer::TransferManager;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub data_dir: String,
    pub log_dir: String,
    pub db_path: String,
    pub log_file: String,
}

pub struct AppState {
    pub paths: AppPaths,
    pub db: Arc<Db>,
    pub settings: Arc<RwLock<Settings>>,
    pub ssh: Arc<SshManager>,
    pub sessions: Arc<SessionManager>,
    pub transfers: Arc<TransferManager>,
}

fn init_logging(
    log_dir: &std::path::Path,
    level: &str,
) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let _ = std::fs::create_dir_all(log_dir);
    let file_appender = tracing_appender::rolling::never(log_dir, "swiftsftp.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new(format!(
            "swiftsftp={level},swiftsftp_lib={level},russh=warn,russh_sftp=warn"
        ))
    });
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .try_init();
    Some(guard)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let log_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| data_dir.join("logs"));
            std::fs::create_dir_all(&data_dir).ok();
            std::fs::create_dir_all(&log_dir).ok();

            let db_path = data_dir.join("swiftsftp.db");
            let db = Arc::new(Db::open(&db_path)?);
            let loaded_settings = db.load_settings();
            let log_guard = init_logging(&log_dir, &loaded_settings.log_level);
            // Keep the appender alive for the process lifetime.
            if let Some(guard) = log_guard {
                Box::leak(Box::new(guard));
            }
            tracing::info!(
                version = env!("CARGO_PKG_VERSION"),
                data_dir = %data_dir.display(),
                "SwiftSFTP Explorer starting"
            );

            let settings = Arc::new(RwLock::new(loaded_settings));
            let ssh = Arc::new(SshManager::new(handle.clone(), db.clone()));
            ssh.spawn_health_monitor();
            let sessions = Arc::new(SessionManager::new(ssh.clone(), handle.clone()));
            let transfers = Arc::new(TransferManager::new(
                handle.clone(),
                ssh.clone(),
                db.clone(),
                settings.clone(),
            ));
            transfers.clone().start();

            let paths = AppPaths {
                data_dir: data_dir.to_string_lossy().to_string(),
                log_dir: log_dir.to_string_lossy().to_string(),
                db_path: db_path.to_string_lossy().to_string(),
                log_file: log_dir.join("swiftsftp.log").to_string_lossy().to_string(),
            };

            app.manage(AppState {
                paths,
                db,
                settings,
                ssh,
                sessions,
                transfers,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::app_paths,
            commands::settings_get,
            commands::settings_set,
            commands::settings_reset,
            commands::settings_export,
            commands::settings_import,
            commands::profiles_list,
            commands::groups_list,
            commands::group_save,
            commands::group_delete,
            commands::profile_save,
            commands::profile_delete,
            commands::profile_duplicate,
            commands::profile_test,
            commands::profile_touch,
            commands::connect,
            commands::disconnect,
            commands::connection_state,
            commands::host_key_respond,
            commands::known_hosts_list,
            commands::known_host_delete,
            commands::trusted_hosts_clear,
            commands::open_session,
            commands::close_session,
            commands::list_dir,
            commands::stat_path,
            commands::mkdir,
            commands::create_file,
            commands::rename_path,
            commands::delete_paths,
            commands::chmod_path,
            commands::read_text_file,
            commands::write_text_file,
            commands::search_files,
            commands::cancel_search,
            commands::set_last_dir,
            commands::transfer_enqueue,
            commands::transfer_list,
            commands::transfer_pause,
            commands::transfer_resume,
            commands::transfer_cancel,
            commands::transfer_retry,
            commands::transfer_retry_failed,
            commands::transfer_clear_completed,
            commands::transfer_history,
            commands::transfer_clear_history,
            commands::enqueue_upload,
            commands::enqueue_download,
            commands::enqueue_remote_copy,
            commands::favorites_list,
            commands::favorite_add,
            commands::favorite_remove,
            commands::recent_list,
            commands::recent_clear,
            commands::open_tabs_load,
            commands::open_tabs_save,
            commands::log_tail,
            commands::clear_credentials,
            commands::factory_reset,
            commands::transfer_queue_depth,
            commands::debug_counts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SwiftSFTP Explorer");
}

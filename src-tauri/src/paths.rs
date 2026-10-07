//! Where Farabi keeps its data and logs (data-model.md §2).

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub struct Paths {
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
}

/// Resolves and creates the data and log folders. `FARABI_DATA_DIR` overrides the data folder;
/// debug builds default to `<repo>/.farabi-dev` so development never touches real data.
pub fn resolve(app: &AppHandle) -> Result<Paths, String> {
    let data_dir = match std::env::var_os("FARABI_DATA_DIR") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ if cfg!(debug_assertions) => repo_root().join(".farabi-dev"),
        _ => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };
    let log_dir = if cfg!(debug_assertions) {
        data_dir.join("logs")
    } else {
        app.path().app_log_dir().map_err(|e| e.to_string())?
    };
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("{}: {e}", data_dir.display()))?;
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("{}: {e}", log_dir.display()))?;
    Ok(Paths { data_dir, log_dir })
}

/// The repository root, for debug builds that run `next dev` from source.
pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

//! Farabi's desktop shell (feature 11): one window, the bundled server, and the OS integrations
//! the server can't do itself. The application logic lives in the server.

mod bridge;
mod credentials;
mod paths;
mod sidecar;

use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
fn restart_server(app: AppHandle) -> Result<(), String> {
    std::thread::spawn(move || {
        if let Err(e) = sidecar::restart(&app) {
            eprintln!("restart failed: {e}");
        }
    });
    Ok(())
}

#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    let dir = sidecar::log_dir().ok_or("no log folder yet")?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// The window may show bundled pages and the server's own origin; everything else (links in
/// replies, docs) opens in the default browser instead (contracts/launch-session.md).
fn allow_navigation(app: &AppHandle, url: &Url) -> bool {
    let local = matches!((url.scheme(), url.host_str()), ("tauri", Some("localhost")) | ("http", Some("tauri.localhost")));
    let ours = url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some()
        && url.port() == sidecar::current_port();
    if local || ours {
        return true;
    }
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    false
}

pub fn run() {
    let app = tauri::Builder::default()
        // First, so a second launch only focuses the existing window (FR-005).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![restart_server, open_logs, quit_app])
        .setup(|app| {
            let handle = app.handle().clone();
            // The standard menu (with Edit), so ⌘C/⌘V/⌘A work on macOS (FR-009).
            #[cfg(target_os = "macos")]
            app.set_menu(tauri::menu::Menu::default(&handle)?)?;

            let nav = handle.clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("starting.html".into()))
                .title("Farabi")
                .inner_size(1280.0, 820.0)
                .min_inner_size(720.0, 480.0)
                .on_navigation(move |url| allow_navigation(&nav, url));
            // Debug builds only: gate G1 injects its probe into the real window (quickstart V1).
            #[cfg(debug_assertions)]
            let builder = builder.on_page_load(|window, payload| {
                if payload.event() != tauri::webview::PageLoadEvent::Finished {
                    return;
                }
                if let Some(js) = std::env::var_os("FARABI_PROBE_JS").and_then(|p| std::fs::read_to_string(p).ok()) {
                    let _ = window.eval(&js);
                }
            });
            builder.build()?;

            let paths = paths::resolve(&handle)?;
            if let Err(e) = sidecar::start(&handle, &paths) {
                let mut url = Url::parse(if cfg!(windows) { "http://tauri.localhost/fatal.html" } else { "tauri://localhost/fatal.html" })?;
                url.query_pairs_mut().append_pair("detail", &e);
                if let Some(w) = handle.get_webview_window("main") {
                    w.navigate(url)?;
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Farabi");

    app.run(|_app, event| {
        if let RunEvent::Exit = event {
            sidecar::stop("quit");
        }
    });
}

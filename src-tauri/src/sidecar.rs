//! Starts, supervises and stops the bundled Next.js server (contracts/launch-session.md).

use base64::Engine;
use serde_json::json;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url};

use crate::bridge::{self, Incoming, Link};
use crate::paths::Paths;

const READY_TIMEOUT: Duration = Duration::from_secs(20);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
const LOG_FILES: u32 = 5;

/// The running server, if any. One per app.
struct Server {
    child: Mutex<Child>,
    link: Arc<Link>,
    port: u16,
    ready: AtomicBool,
    stopping: AtomicBool,
}

static CURRENT: Mutex<Option<Arc<Server>>> = Mutex::new(None);
static PATHS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();
static LAST_AUTO_RESTART: Mutex<Option<Instant>> = Mutex::new(None);

/// The port the window may navigate to (used by the navigation guard).
pub fn current_port() -> Option<u16> {
    CURRENT.lock().unwrap().as_ref().map(|s| s.port)
}

pub fn log_dir() -> Option<PathBuf> {
    PATHS.get().map(|(_, l)| l.clone())
}

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

fn new_secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS random source");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// The local URL of a bundled page (tauri.conf.json `frontendDist`).
fn local_page(page: &str) -> Url {
    let base = if cfg!(windows) { "http://tauri.localhost/" } else { "tauri://localhost/" };
    Url::parse(base).unwrap().join(page).unwrap()
}

pub fn show_page(app: &AppHandle, page: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(local_page(page));
    }
}

fn show_fatal(app: &AppHandle, detail: &str) {
    // Also on stderr and in the log, so a failure before the window shows is still visible.
    eprintln!("fatal: {detail}");
    log_line(&format!("fatal: {detail}"));
    let mut url = local_page("fatal.html");
    url.query_pairs_mut().append_pair("detail", detail);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(url);
    }
}

fn command(app: &AppHandle, port: u16, data_dir: &Path) -> Result<Command, String> {
    let prod_dir = std::env::var_os("FARABI_SERVER_DIR").filter(|_| cfg!(debug_assertions));
    let mut cmd = if let Some(dir) = prod_dir {
        // Development, measuring the shipped build: a prepared standalone server (for example the
        // test-hooks build in .desktop-test/server) with the system Node (gate G1).
        let dir = PathBuf::from(dir);
        let mut c = Command::new(if cfg!(windows) { "node.exe" } else { "node" });
        c.arg(dir.join("server.js")).current_dir(&dir).env("NODE_ENV", "production");
        c
    } else if cfg!(debug_assertions) {
        // Development: run `next dev` from the repo with the system Node.
        let root = crate::paths::repo_root();
        let mut c = Command::new(if cfg!(windows) { "node.exe" } else { "node" });
        c.arg(root.join("node_modules/next/dist/bin/next"))
            .args(["dev", "-H", "127.0.0.1", "-p", &port.to_string()])
            .current_dir(&root);
        c
    } else {
        // Release: the bundled Node sidecar next to the executable, and the bundled server.
        let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().unwrap().to_path_buf();
        let node = exe_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
        let server = app.path().resource_dir().map_err(|e| e.to_string())?.join("server");
        let mut c = Command::new(node);
        c.arg(server.join("server.js")).current_dir(&server).env("NODE_ENV", "production");
        c
    };
    cmd.env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("FARABI_HOST", "tauri")
        .env("FARABI_DATA_DIR", data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    Ok(cmd)
}

/// Starts the server and wires its stdio to the bridge, logs and the window.
pub fn start(app: &AppHandle, paths: &Paths) -> Result<(), String> {
    let _ = PATHS.set((paths.data_dir.clone(), paths.log_dir.clone()));
    let port = free_port().map_err(|e| e.to_string())?;
    let secret = new_secret();
    let mut child = command(app, port, &paths.data_dir)?.spawn().map_err(|e| format!("Could not start the server: {e}"))?;
    let link = Link::new(child.stdin.take().unwrap());
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let server = Arc::new(Server { child: Mutex::new(child), link: link.clone(), port, ready: AtomicBool::new(false), stopping: AtomicBool::new(false) });
    *CURRENT.lock().unwrap() = Some(server.clone());

    pipe_logs(stderr, paths.log_dir.join("server.log"));

    // Reader: every stdout line is a bridge message.
    {
        let (app, server, secret) = (app.clone(), server.clone(), secret.clone());
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                match bridge::handle_line(&app, &server.link, &line) {
                    Incoming::Ready => {
                        server.ready.store(true, Ordering::SeqCst);
                        let url = format!("http://127.0.0.1:{}/__farabi/session?t={}", server.port, secret);
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.navigate(Url::parse(&url).unwrap());
                        }
                    }
                    Incoming::Blocked { screen, detail } => {
                        let mut url = local_page("blocked.html");
                        url.query_pairs_mut().append_pair("screen", &screen).append_pair("detail", &detail);
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.navigate(url);
                        }
                    }
                    Incoming::Fatal { message } => show_fatal(&app, &message),
                    Incoming::Handled => {}
                }
            }
        });
    }

    // The first message: who the server is and the secret it must require.
    link.send(&json!({ "v": 1, "id": "h1", "type": "hello", "params": {
        "secret": secret, "port": port,
        "dataDir": paths.data_dir, "logDir": paths.log_dir,
        "appVersion": app.package_info().version.to_string(),
        "platform": if cfg!(windows) { "windows" } else { "macos" },
        "arch": std::env::consts::ARCH,
    }}));

    // Ready timeout.
    {
        let (app, server) = (app.clone(), server.clone());
        std::thread::spawn(move || {
            std::thread::sleep(READY_TIMEOUT);
            if !server.ready.load(Ordering::SeqCst) && !server.stopping.load(Ordering::SeqCst) {
                show_fatal(&app, "Farabi took too long to start.");
            }
        });
    }

    // Watcher: an exit nobody asked for shows the fatal page and restarts at most once a minute.
    {
        let (app, server) = (app.clone(), server.clone());
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(250));
            let exited = server.child.lock().unwrap().try_wait().ok().flatten();
            let Some(status) = exited else { continue };
            if server.stopping.load(Ordering::SeqCst) {
                return;
            }
            server.link.close();
            let mut last = LAST_AUTO_RESTART.lock().unwrap();
            if last.map_or(true, |t| t.elapsed() > Duration::from_secs(60)) {
                *last = Some(Instant::now());
                drop(last);
                show_page(&app, "starting.html");
                if let Some((data, logs)) = PATHS.get() {
                    let paths = Paths { data_dir: data.clone(), log_dir: logs.clone() };
                    if let Err(e) = start(&app, &paths) {
                        show_fatal(&app, &e);
                    }
                }
            } else {
                show_fatal(&app, &format!("The Farabi server stopped ({status})."));
            }
            return;
        });
    }
    Ok(())
}

/// Asks the server to shut down cleanly (close the store, remove runtime.json and the lock),
/// then kills it if it hasn't exited in time.
pub fn stop(reason: &str) {
    let Some(server) = CURRENT.lock().unwrap().take() else { return };
    server.stopping.store(true, Ordering::SeqCst);
    let _ = server.link.request("shutdown", json!({ "reason": reason }), SHUTDOWN_TIMEOUT);
    let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    loop {
        if let Ok(Some(_)) = server.child.lock().unwrap().try_wait() {
            break;
        }
        if Instant::now() > deadline {
            let _ = server.child.lock().unwrap().kill();
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    server.link.close();
}

/// Restart on request (the fatal page's Restart button).
pub fn restart(app: &AppHandle) -> Result<(), String> {
    stop("quit");
    show_page(app, "starting.html");
    let (data, logs) = PATHS.get().cloned().ok_or("not started")?;
    start(app, &Paths { data_dir: data, log_dir: logs })
}

/// Appends one non-protocol stdout line (Next.js's own output) to the server log.
pub fn log_line(line: &str) {
    if cfg!(debug_assertions) {
        eprintln!("{line}");
    }
    if let Some((_, logs)) = PATHS.get() {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(logs.join("server.log")) {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// Copies the server's stderr into a size-rotated log file (5 MB × 5).
fn pipe_logs(mut stderr: impl Read + Send + 'static, path: PathBuf) {
    std::thread::spawn(move || {
        let open = |p: &Path| OpenOptions::new().create(true).append(true).open(p);
        let Ok(mut file) = open(&path) else { return };
        let mut buf = [0u8; 8192];
        loop {
            let n = match stderr.read(&mut buf) {
                Ok(0) | Err(_) => return,
                Ok(n) => n,
            };
            let _ = file.write_all(&buf[..n]);
            if cfg!(debug_assertions) {
                let _ = std::io::stderr().write_all(&buf[..n]);
            }
            if file.metadata().map(|m| m.len()).unwrap_or(0) > LOG_MAX_BYTES {
                rotate(&path);
                match open(&path) {
                    Ok(f) => file = f,
                    Err(_) => return,
                }
            }
        }
    });
}

fn rotate(path: &Path) {
    for i in (1..LOG_FILES).rev() {
        let from = path.with_extension(format!("log.{i}"));
        let to = path.with_extension(format!("log.{}", i + 1));
        let _ = std::fs::rename(from, to);
    }
    let _ = std::fs::rename(path, path.with_extension("log.1"));
    let _ = File::create(path);
}

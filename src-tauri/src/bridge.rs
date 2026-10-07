//! The shell's side of the stdio bridge (contracts/host-bridge.md): framing, request/response
//! matching, and the handlers for requests the server sends to the shell.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::credentials;

pub const MAX_LINE_BYTES: usize = 1024 * 1024;

/// Writes framed messages to the server's stdin and tracks shell → server requests.
pub struct Link {
    stdin: Mutex<Option<std::process::ChildStdin>>,
    pending: Mutex<HashMap<String, Sender<Result<Value, String>>>>,
    next_id: Mutex<u64>,
}

impl Link {
    pub fn new(stdin: std::process::ChildStdin) -> Arc<Self> {
        Arc::new(Self { stdin: Mutex::new(Some(stdin)), pending: Mutex::new(HashMap::new()), next_id: Mutex::new(1) })
    }

    pub fn send(&self, msg: &Value) {
        let mut line = msg.to_string();
        line.push('\n');
        if let Some(stdin) = self.stdin.lock().unwrap().as_mut() {
            let _ = stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush());
        }
    }

    /// Sends a request and waits for the matching response.
    pub fn request(&self, kind: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = {
            let mut n = self.next_id.lock().unwrap();
            *n += 1;
            format!("h{}", *n)
        };
        let (tx, rx) = channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        self.send(&json!({ "v": 1, "id": id, "type": kind, "params": params }));
        let res = rx.recv_timeout(timeout).unwrap_or_else(|_| Err(format!("{kind}: timeout")));
        self.pending.lock().unwrap().remove(&id);
        res
    }

    pub fn event(&self, event: &str, data: Value) {
        self.send(&json!({ "v": 1, "event": event, "data": data }));
    }

    fn resolve(&self, re: &str, result: Result<Value, String>) {
        if let Some(tx) = self.pending.lock().unwrap().remove(re) {
            let _ = tx.send(result);
        }
    }

    pub fn close(&self) {
        self.stdin.lock().unwrap().take();
    }
}

/// What the supervisor must do in response to a server message.
pub enum Incoming {
    Ready,
    Blocked { screen: String, detail: String },
    Fatal { message: String },
    Handled,
}

/// Parses one line from the server's stdout and handles it.
pub fn handle_line(app: &AppHandle, link: &Arc<Link>, line: &str) -> Incoming {
    if line.len() > MAX_LINE_BYTES || line.trim().is_empty() {
        return Incoming::Handled;
    }
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        // The server sends logs to stderr; a non-JSON stdout line is a stray write. Log it.
        Err(_) => {
            eprintln!("[bridge] ignored non-protocol line on stdout");
            return Incoming::Handled;
        }
    };
    if msg["v"] != 1 {
        return Incoming::Handled;
    }
    if let Some(re) = msg["re"].as_str() {
        let result = if msg["ok"] == true {
            Ok(msg.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(msg["error"]["message"].as_str().unwrap_or("error").to_string())
        };
        link.resolve(re, result);
        return Incoming::Handled;
    }
    if let Some(event) = msg["event"].as_str() {
        let data = &msg["data"];
        return match event {
            "ready" => Incoming::Ready,
            "blocked" => Incoming::Blocked {
                screen: data["screen"].as_str().unwrap_or("").to_string(),
                detail: data["detail"].as_str().unwrap_or("").to_string(),
            },
            "fatal" => Incoming::Fatal { message: data["message"].as_str().unwrap_or("").to_string() },
            _ => Incoming::Handled,
        };
    }
    if let (Some(id), Some(kind)) = (msg["id"].as_str(), msg["type"].as_str()) {
        // Handlers may block (dialogs, keychain prompts), so never on the reader thread.
        let (app, link, id, kind, params) = (app.clone(), link.clone(), id.to_string(), kind.to_string(), msg["params"].clone());
        std::thread::spawn(move || {
            let reply = match dispatch(&app, &link, &kind, &params) {
                Ok(result) => json!({ "v": 1, "re": id, "ok": true, "result": result }),
                Err((code, message)) => json!({ "v": 1, "re": id, "ok": false, "error": { "code": code, "message": message } }),
            };
            link.send(&reply);
        });
    }
    Incoming::Handled
}

type HandlerResult = Result<Value, (&'static str, String)>;

fn dispatch(app: &AppHandle, link: &Arc<Link>, kind: &str, params: &Value) -> HandlerResult {
    let name = params["name"].as_str().unwrap_or("");
    let cred = |r: Result<Value, credentials::CredError>| r.map_err(|e| (e.code, e.message));
    match kind {
        "credentials.get" => cred(credentials::get(name, params["reveal"] == true)),
        "credentials.set" => {
            let value = params["value"].as_str().ok_or(("bad_request", "value is required".to_string()))?;
            let res = cred(credentials::set(name, value))?;
            link.event("credentials.changed", json!({ "name": name }));
            Ok(res)
        }
        "credentials.delete" => {
            let res = cred(credentials::delete(name))?;
            link.event("credentials.changed", json!({ "name": name }));
            Ok(res)
        }
        "dialog.pickFolder" => {
            let mut dialog = app.dialog().file();
            if let Some(title) = params["title"].as_str() {
                dialog = dialog.set_title(title);
            }
            if let Some(dir) = params["defaultPath"].as_str() {
                dialog = dialog.set_directory(dir);
            }
            if let Some(w) = app.get_webview_window("main") {
                dialog = dialog.set_parent(&w);
            }
            let picked = dialog.blocking_pick_folder().and_then(|p| p.into_path().ok());
            Ok(json!({ "path": picked.map(|p| p.to_string_lossy().to_string()) }))
        }
        "shell.reveal" => {
            // Only shows the item in Finder/Explorer; it never opens or runs it.
            let path = params["path"].as_str().ok_or(("bad_request", "path is required".to_string()))?;
            let p = std::path::Path::new(path);
            if !p.is_absolute() || !p.exists() {
                return Err(("forbidden", "Only existing absolute paths can be revealed".to_string()));
            }
            app.opener().reveal_item_in_dir(p).map_err(|e| ("error", e.to_string()))?;
            Ok(json!({ "ok": true }))
        }
        "window.focus" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(json!({ "ok": true }))
        }
        _ => Err(("unsupported", format!("Unknown request {kind}"))),
    }
}

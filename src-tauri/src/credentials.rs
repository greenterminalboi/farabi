//! The Claude API key in the OS credential store: macOS Keychain, Windows Credential Manager
//! (research R8, FR-013). Only names on the allow-list can be touched.

use serde_json::{json, Value};

const SERVICE: &str = "app.farabi";
const ALLOWED: &[&str] = &["anthropic-api-key"];

pub struct CredError {
    pub code: &'static str,
    pub message: String,
}

fn entry(name: &str) -> Result<keyring::Entry, CredError> {
    if !ALLOWED.contains(&name) {
        return Err(CredError { code: "forbidden", message: format!("{name} is not an allowed credential") });
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| CredError { code: "error", message: e.to_string() })
}

/// `{ present, value? }`; the value only when `reveal` is set.
pub fn get(name: &str, reveal: bool) -> Result<Value, CredError> {
    match entry(name)?.get_password() {
        Ok(v) if reveal => Ok(json!({ "present": true, "value": v })),
        Ok(_) => Ok(json!({ "present": true })),
        Err(keyring::Error::NoEntry) => Ok(json!({ "present": false })),
        Err(e) => Err(CredError { code: "error", message: e.to_string() }),
    }
}

pub fn set(name: &str, value: &str) -> Result<Value, CredError> {
    entry(name)?
        .set_password(value)
        .map(|_| json!({ "ok": true }))
        .map_err(|e| CredError { code: "error", message: e.to_string() })
}

/// Idempotent: deleting a missing credential succeeds.
pub fn delete(name: &str) -> Result<Value, CredError> {
    match entry(name)?.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(json!({ "ok": true })),
        Err(e) => Err(CredError { code: "error", message: e.to_string() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_names_off_the_allow_list() {
        let err = get("github-token", false).err().expect("should be refused");
        assert_eq!(err.code, "forbidden");
        assert_eq!(set("x", "y").err().unwrap().code, "forbidden");
        assert_eq!(delete("x").err().unwrap().code, "forbidden");
    }
}

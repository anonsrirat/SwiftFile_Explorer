//! Small abstraction over the event emitter.
//!
//! The managers in this crate only need an event sink to push progress to the
//! webview. Hiding that behind a trait keeps the networking core independent of
//! a running Tauri application, which is what makes the end-to-end tests in
//! `tests/sftp_integration.rs` possible.

use std::sync::Arc;

pub trait EventSink: Send + Sync + 'static {
    fn emit_json(&self, event: &str, payload: serde_json::Value);
}

impl EventSink for tauri::AppHandle {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        use tauri::Emitter;
        let _ = self.emit(event, payload);
    }
}

pub type Sink = Arc<dyn EventSink>;

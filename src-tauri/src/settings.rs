//! Persistent application settings.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    // General
    pub theme: String,
    pub language: String,
    pub start_behavior: String,
    pub restore_tabs: bool,
    pub default_local_folder: Option<String>,
    // Appearance
    pub view_mode: String,
    pub compact: bool,
    pub animations: bool,
    pub show_hidden: bool,
    // Performance
    pub max_concurrent_transfers: u32,
    pub buffer_size_kb: u32,
    pub speed_limit_kbps: u32,
    pub retry_count: u32,
    pub timeout_secs: u32,
    pub keepalive_secs: u32,
    // Security / behaviour
    pub allow_server_commands: bool,
    pub verify_checksums: bool,
    pub confirm_delete: bool,
    pub log_level: String,
    /// False until the first-run security notice has been acknowledged.
    #[serde(default)]
    pub onboarded: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            language: "en".into(),
            start_behavior: "restore".into(),
            restore_tabs: true,
            default_local_folder: None,
            view_mode: "details".into(),
            compact: false,
            animations: true,
            show_hidden: false,
            max_concurrent_transfers: 4,
            buffer_size_kb: 256,
            speed_limit_kbps: 0,
            retry_count: 3,
            timeout_secs: 20,
            keepalive_secs: 30,
            // Off by default: running shell commands on the server (server-side
            // copy, remote checksums) must be an explicit, informed opt-in.
            allow_server_commands: false,
            verify_checksums: true,
            confirm_delete: true,
            log_level: "info".into(),
            onboarded: false,
        }
    }
}

impl Settings {
    /// Clamp values into ranges that are safe for the engine.
    pub fn sanitize(&mut self) {
        if !matches!(self.theme.as_str(), "system" | "dark" | "light") {
            self.theme = "system".into();
        }
        if !matches!(self.language.as_str(), "en" | "th") {
            self.language = "en".into();
        }
        if !matches!(self.view_mode.as_str(), "details" | "grid" | "list") {
            self.view_mode = "details".into();
        }
        self.max_concurrent_transfers = self.max_concurrent_transfers.clamp(1, 16);
        self.buffer_size_kb = self.buffer_size_kb.clamp(32, 4096);
        self.retry_count = self.retry_count.clamp(0, 10);
        self.timeout_secs = self.timeout_secs.clamp(5, 300);
        self.keepalive_secs = self.keepalive_secs.clamp(5, 300);
        self.speed_limit_kbps = self.speed_limit_kbps.min(4_000_000);
    }

    pub fn chunk_size(&self) -> usize {
        (self.buffer_size_kb as usize) * 1024
    }
}

use std::fmt;

/// Error type returned by every Tauri command. Serialised to the frontend so the
/// UI can make decisions (e.g. `host_key_changed`, `conflict`, `not_found`).
#[derive(Debug, Clone, serde::Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn msg(message: impl Into<String>) -> Self {
        Self::new("error", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }

    pub fn cancelled() -> Self {
        Self::new("cancelled", "Operation cancelled")
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new("unsupported", message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

impl From<russh::Error> for AppError {
    fn from(e: russh::Error) -> Self {
        let message = e.to_string();
        let code = if message.contains("connection") || message.contains("closed") {
            "connection_lost"
        } else {
            "ssh_error"
        };
        AppError::new(code, format!("SSH error: {message}"))
    }
}

impl From<russh_sftp::client::error::Error> for AppError {
    fn from(e: russh_sftp::client::error::Error) -> Self {
        let message = e.to_string();
        let lower = message.to_lowercase();
        let code = if lower.contains("permission denied") {
            "permission_denied"
        } else if lower.contains("no such file") {
            "not_found"
        } else if lower.contains("connection lost") || lower.contains("no connection") {
            "connection_lost"
        } else if lower.contains("not supported") {
            "unsupported"
        } else {
            "sftp_error"
        };
        AppError::new(code, format!("SFTP error: {message}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        let code = match e.kind() {
            std::io::ErrorKind::NotFound => "not_found",
            std::io::ErrorKind::PermissionDenied => "permission_denied",
            std::io::ErrorKind::AlreadyExists => "already_exists",
            _ => "io_error",
        };
        AppError::new(code, e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::new("database_error", e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::new("serialization_error", e.to_string())
    }
}

impl From<tokio::time::error::Elapsed> for AppError {
    fn from(_: tokio::time::error::Elapsed) -> Self {
        AppError::new("timeout", "The operation timed out")
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::new("app_error", e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

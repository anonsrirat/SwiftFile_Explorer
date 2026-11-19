//! POSIX-style remote path helpers. All remote paths are handled as strings
//! with `/` separators because that is what SFTP speaks on the wire, regardless
//! of the client OS.

/// Normalise a remote path: collapse duplicate slashes, resolve `.` and `..`.
/// Relative paths stay relative (no leading slash is invented).
pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if matches!(parts.last(), Some(&last) if last != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else if joined.is_empty() {
        ".".to_string()
    } else {
        joined
    }
}

/// Join a remote base directory with a name, handling absolute names.
pub fn join(base: &str, name: &str) -> String {
    if name.starts_with('/') {
        return normalize(name);
    }
    if base.is_empty() || base == "." {
        return normalize(name);
    }
    normalize(&format!("{}/{}", base.trim_end_matches('/'), name))
}

pub fn parent(path: &str) -> String {
    let normalized = normalize(path);
    if normalized == "/" || normalized == "." {
        return normalized;
    }
    match normalized.rfind('/') {
        Some(0) => "/".to_string(),
        Some(idx) => normalized[..idx].to_string(),
        None => ".".to_string(),
    }
}

pub fn file_name(path: &str) -> String {
    let normalized = normalize(path);
    if normalized == "/" {
        return "/".to_string();
    }
    normalized
        .rsplit('/')
        .next()
        .unwrap_or(&normalized)
        .to_string()
}

pub fn is_root(path: &str) -> bool {
    let normalized = normalize(path);
    normalized == "/" || normalized.is_empty()
}

pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') && name != "." && name != ".."
}

/// Quote a string for safe use as a single POSIX shell argument.
/// This is the only place user-controlled text is embedded in a shell command.
pub fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    // Only unquoted for clearly safe characters; everything else single-quoted.
    let safe = value.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || matches!(c, '/' | '.' | '_' | '-' | '+' | ':' | '@' | ',' | '%')
    });
    if safe {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Guard against obviously destructive remote targets.
pub fn is_dangerous_target(path: &str) -> bool {
    let normalized = normalize(path);
    normalized == "/" || normalized == "." || normalized == ".." || normalized.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_paths() {
        assert_eq!(normalize("/home//user/./dir/"), "/home/user/dir");
        assert_eq!(normalize("/home/user/../other"), "/home/other");
        assert_eq!(normalize("/"), "/");
        assert_eq!(normalize(""), ".");
        assert_eq!(normalize("../a"), "../a");
        assert_eq!(normalize("/../etc"), "/etc");
    }

    #[test]
    fn joins_paths() {
        assert_eq!(join("/srv", "plugins"), "/srv/plugins");
        assert_eq!(join("/srv/", "plugins"), "/srv/plugins");
        assert_eq!(join("/srv", "/etc/hosts"), "/etc/hosts");
        assert_eq!(join(".", "file.txt"), "file.txt");
    }

    #[test]
    fn computes_parent_and_name() {
        assert_eq!(parent("/home/user/file.txt"), "/home/user");
        assert_eq!(parent("/home"), "/");
        assert_eq!(parent("/"), "/");
        assert_eq!(file_name("/home/user/file.txt"), "file.txt");
        assert_eq!(file_name("/"), "/");
    }

    #[test]
    fn quotes_shell_arguments() {
        assert_eq!(
            shell_quote("/srv/plugins/core.jar"),
            "/srv/plugins/core.jar"
        );
        assert_eq!(shell_quote("it's a file"), "'it'\\''s a file'");
        assert_eq!(shell_quote("a b; rm -rf /"), "'a b; rm -rf /'");
        assert_eq!(shell_quote("$(whoami)"), "'$(whoami)'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn detects_dangerous_targets() {
        assert!(is_dangerous_target("/"));
        assert!(is_dangerous_target("/.."));
        assert!(!is_dangerous_target("/home"));
        assert!(!is_dangerous_target("/home/user"));
    }

    #[test]
    fn detects_hidden_names() {
        assert!(is_hidden_name(".bashrc"));
        assert!(!is_hidden_name("bashrc"));
        assert!(!is_hidden_name(".."));
    }
}

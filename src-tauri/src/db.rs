//! SQLite persistence: server profiles, trusted host keys, favourites, recent
//! folders, transfer history and settings. Passwords are stored only as DPAPI
//! blobs (see `secrets`), never in plain text.

use crate::error::AppResult;
use crate::settings::Settings;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub group_name: String,
    /// Accent colour for this server (`#rrggbb`); falls back to the group colour.
    #[serde(default)]
    pub color: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    /// `password` | `key` | `agent`
    pub auth_method: String,
    pub key_path: Option<String>,
    pub default_remote_dir: Option<String>,
    pub timeout_secs: u16,
    pub keepalive_secs: u16,
    pub auto_connect: bool,
    /// Last folder visited on this server (restored when reopening a tab).
    pub last_dir: Option<String>,
    pub has_password: bool,
    pub has_passphrase: bool,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerGroup {
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub position: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub id: i64,
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub key_b64: String,
    pub accepted_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub profile_id: String,
    pub path: String,
    pub label: String,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub profile_id: String,
    pub path: String,
    pub label: String,
    pub visited_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub source: String,
    pub dest: String,
    pub size: i64,
    pub status: String,
    pub method: Option<String>,
    pub error: Option<String>,
    pub finished_at: i64,
}

pub struct Db {
    conn: Mutex<Connection>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                group_name TEXT NOT NULL DEFAULT 'Ungrouped',
                host TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                username TEXT NOT NULL,
                auth_method TEXT NOT NULL DEFAULT 'password',
                key_path TEXT,
                default_remote_dir TEXT,
                timeout_secs INTEGER NOT NULL DEFAULT 20,
                keepalive_secs INTEGER NOT NULL DEFAULT 30,
                auto_connect INTEGER NOT NULL DEFAULT 0,
                last_dir TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS secrets (
                profile_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                blob TEXT NOT NULL,
                PRIMARY KEY (profile_id, kind)
            );

            CREATE TABLE IF NOT EXISTS known_hosts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                algorithm TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                key_b64 TEXT NOT NULL,
                accepted_at INTEGER NOT NULL,
                UNIQUE (host, port, algorithm)
            );

            CREATE TABLE IF NOT EXISTS favorites (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                path TEXT NOT NULL,
                label TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE (profile_id, path)
            );

            CREATE TABLE IF NOT EXISTS recent (
                profile_id TEXT NOT NULL,
                path TEXT NOT NULL,
                label TEXT NOT NULL,
                visited_at INTEGER NOT NULL,
                PRIMARY KEY (profile_id, path)
            );

            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                source TEXT NOT NULL,
                dest TEXT NOT NULL,
                size INTEGER NOT NULL,
                status TEXT NOT NULL,
                method TEXT,
                error TEXT,
                finished_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS kv (
                k TEXT PRIMARY KEY,
                v TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS server_groups (
                name TEXT PRIMARY KEY,
                color TEXT NOT NULL DEFAULT '#6f6cf8',
                position INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )?;
        // Added in 1.1.0: per-server accent colour. Ignore the error when the
        // column already exists so upgrades are idempotent.
        let _ = conn.execute("ALTER TABLE profiles ADD COLUMN color TEXT", []);
        Ok(())
    }

    // ---------- profiles ----------

    pub fn list_profiles(&self) -> AppResult<Vec<Profile>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.group_name, p.host, p.port, p.username, p.auth_method,
                    p.key_path, p.default_remote_dir, p.timeout_secs, p.keepalive_secs,
                    p.auto_connect, p.last_dir, p.created_at, p.updated_at,
                    EXISTS(SELECT 1 FROM secrets s WHERE s.profile_id = p.id AND s.kind = 'password'),
                    EXISTS(SELECT 1 FROM secrets s WHERE s.profile_id = p.id AND s.kind = 'passphrase'),
                    p.color
             FROM profiles p ORDER BY p.group_name COLLATE NOCASE, p.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Profile {
                id: r.get(0)?,
                name: r.get(1)?,
                group_name: r.get(2)?,
                host: r.get(3)?,
                port: r.get::<_, i64>(4)? as u16,
                username: r.get(5)?,
                auth_method: r.get(6)?,
                key_path: r.get(7)?,
                default_remote_dir: r.get(8)?,
                timeout_secs: r.get::<_, i64>(9)? as u16,
                keepalive_secs: r.get::<_, i64>(10)? as u16,
                auto_connect: r.get::<_, i64>(11)? != 0,
                last_dir: r.get(12)?,
                created_at: r.get(13)?,
                updated_at: r.get(14)?,
                has_password: r.get::<_, i64>(15)? != 0,
                has_passphrase: r.get::<_, i64>(16)? != 0,
                color: r.get(17)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_profile(&self, id: &str) -> AppResult<Option<Profile>> {
        Ok(self.list_profiles()?.into_iter().find(|p| p.id == id))
    }

    pub fn save_profile(&self, profile: &Profile) -> AppResult<()> {
        let conn = self.conn.lock();
        let now = now_ms();
        let created = if profile.created_at > 0 {
            profile.created_at
        } else {
            now
        };
        conn.execute(
            "INSERT INTO profiles (id, name, group_name, host, port, username, auth_method,
                                   key_path, default_remote_dir, timeout_secs, keepalive_secs,
                                   auto_connect, last_dir, created_at, updated_at, color)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, group_name=excluded.group_name, host=excluded.host,
                port=excluded.port, username=excluded.username, auth_method=excluded.auth_method,
                key_path=excluded.key_path, default_remote_dir=excluded.default_remote_dir,
                timeout_secs=excluded.timeout_secs, keepalive_secs=excluded.keepalive_secs,
                auto_connect=excluded.auto_connect, last_dir=COALESCE(excluded.last_dir, profiles.last_dir),
                color=excluded.color, updated_at=excluded.updated_at",
            params![
                profile.id,
                profile.name,
                profile.group_name,
                profile.host,
                profile.port as i64,
                profile.username,
                profile.auth_method,
                profile.key_path,
                profile.default_remote_dir,
                profile.timeout_secs as i64,
                profile.keepalive_secs as i64,
                if profile.auto_connect { 1 } else { 0 },
                profile.last_dir,
                created,
                now,
                profile.color
            ],
        )?;
        Ok(())
    }

    pub fn delete_profile(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM profiles WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM secrets WHERE profile_id = ?1", params![id])?;
        conn.execute("DELETE FROM favorites WHERE profile_id = ?1", params![id])?;
        conn.execute("DELETE FROM recent WHERE profile_id = ?1", params![id])?;
        Ok(())
    }

    // ---------- server groups ----------

    pub fn list_groups(&self) -> AppResult<Vec<ServerGroup>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT name, color, position FROM server_groups ORDER BY position, name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(ServerGroup {
                name: r.get(0)?,
                color: r.get(1)?,
                position: r.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Create or update a group. Renaming through `previous` moves the profiles
    /// that still point at the old name.
    pub fn save_group(&self, group: &ServerGroup, previous: Option<&str>) -> AppResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        if let Some(old) = previous {
            if old != group.name {
                tx.execute(
                    "UPDATE profiles SET group_name = ?2 WHERE group_name = ?1",
                    params![old, group.name],
                )?;
                tx.execute("DELETE FROM server_groups WHERE name = ?1", params![old])?;
            }
        }
        tx.execute(
            "INSERT INTO server_groups (name, color, position) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET color = excluded.color, position = excluded.position",
            params![group.name, group.color, group.position],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Removes the group; its servers fall back to `Ungrouped`.
    pub fn delete_group(&self, name: &str) -> AppResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE profiles SET group_name = 'Ungrouped' WHERE group_name = ?1",
            params![name],
        )?;
        tx.execute("DELETE FROM server_groups WHERE name = ?1", params![name])?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_last_dir(&self, id: &str, dir: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE profiles SET last_dir = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, dir, now_ms()],
        )?;
        Ok(())
    }

    // ---------- secrets ----------

    pub fn set_secret(&self, profile_id: &str, kind: &str, blob: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO secrets (profile_id, kind, blob) VALUES (?1,?2,?3)
             ON CONFLICT(profile_id, kind) DO UPDATE SET blob = excluded.blob",
            params![profile_id, kind, blob],
        )?;
        Ok(())
    }

    pub fn get_secret_blob(&self, profile_id: &str, kind: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock();
        let blob = conn
            .query_row(
                "SELECT blob FROM secrets WHERE profile_id = ?1 AND kind = ?2",
                params![profile_id, kind],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(blob)
    }

    pub fn delete_secret(&self, profile_id: &str, kind: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM secrets WHERE profile_id = ?1 AND kind = ?2",
            params![profile_id, kind],
        )?;
        Ok(())
    }

    pub fn clear_all_secrets(&self) -> AppResult<usize> {
        let conn = self.conn.lock();
        Ok(conn.execute("DELETE FROM secrets", [])?)
    }

    pub fn secret_count(&self) -> AppResult<i64> {
        let conn = self.conn.lock();
        Ok(conn.query_row("SELECT COUNT(*) FROM secrets", [], |r| r.get(0))?)
    }

    // ---------- known hosts ----------

    pub fn known_hosts_for(&self, host: &str, port: u16) -> AppResult<Vec<KnownHost>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, host, port, algorithm, fingerprint, key_b64, accepted_at
             FROM known_hosts WHERE host = ?1 AND port = ?2",
        )?;
        let rows = stmt.query_map(params![host, port as i64], |r| {
            Ok(KnownHost {
                id: r.get(0)?,
                host: r.get(1)?,
                port: r.get::<_, i64>(2)? as u16,
                algorithm: r.get(3)?,
                fingerprint: r.get(4)?,
                key_b64: r.get(5)?,
                accepted_at: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn list_known_hosts(&self) -> AppResult<Vec<KnownHost>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, host, port, algorithm, fingerprint, key_b64, accepted_at
             FROM known_hosts ORDER BY host COLLATE NOCASE, port",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(KnownHost {
                id: r.get(0)?,
                host: r.get(1)?,
                port: r.get::<_, i64>(2)? as u16,
                algorithm: r.get(3)?,
                fingerprint: r.get(4)?,
                key_b64: r.get(5)?,
                accepted_at: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn trust_host(
        &self,
        host: &str,
        port: u16,
        algorithm: &str,
        fingerprint: &str,
        key_b64: &str,
    ) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO known_hosts (host, port, algorithm, fingerprint, key_b64, accepted_at)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(host, port, algorithm) DO UPDATE SET
                fingerprint = excluded.fingerprint,
                key_b64 = excluded.key_b64,
                accepted_at = excluded.accepted_at",
            params![host, port as i64, algorithm, fingerprint, key_b64, now_ms()],
        )?;
        Ok(())
    }

    pub fn delete_known_host(&self, id: i64) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM known_hosts WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ---------- favourites / recent ----------

    pub fn list_favorites(&self, profile_id: Option<&str>) -> AppResult<Vec<Favorite>> {
        let conn = self.conn.lock();
        let map = |r: &rusqlite::Row<'_>| {
            Ok(Favorite {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                path: r.get(2)?,
                label: r.get(3)?,
                created_at: r.get(4)?,
            })
        };
        let sql = if profile_id.is_some() {
            "SELECT id, profile_id, path, label, created_at FROM favorites
             WHERE profile_id = ?1 ORDER BY created_at DESC"
        } else {
            "SELECT id, profile_id, path, label, created_at FROM favorites
             ORDER BY created_at DESC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = match profile_id {
            Some(id) => stmt.query_map(params![id], map)?,
            None => stmt.query_map([], map)?,
        };
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn add_favorite(
        &self,
        id: &str,
        profile_id: &str,
        path: &str,
        label: &str,
    ) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO favorites (id, profile_id, path, label, created_at)
             VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(profile_id, path) DO UPDATE SET label = excluded.label",
            params![id, profile_id, path, label, now_ms()],
        )?;
        Ok(())
    }

    pub fn remove_favorite(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM favorites WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_recent(&self) -> AppResult<Vec<RecentEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT profile_id, path, label, visited_at FROM recent
             ORDER BY visited_at DESC LIMIT 25",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(RecentEntry {
                profile_id: r.get(0)?,
                path: r.get(1)?,
                label: r.get(2)?,
                visited_at: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn touch_recent(&self, profile_id: &str, path: &str, label: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO recent (profile_id, path, label, visited_at) VALUES (?1,?2,?3,?4)
             ON CONFLICT(profile_id, path) DO UPDATE SET visited_at = excluded.visited_at,
                label = excluded.label",
            params![profile_id, path, label, now_ms()],
        )?;
        conn.execute(
            "DELETE FROM recent WHERE rowid NOT IN
                (SELECT rowid FROM recent ORDER BY visited_at DESC LIMIT 200)",
            [],
        )?;
        Ok(())
    }

    pub fn clear_recent(&self) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM recent", [])?;
        Ok(())
    }

    // ---------- history ----------

    pub fn add_history(&self, entry: &HistoryEntry) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO history (id, name, kind, source, dest, size, status, method, error, finished_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                entry.id, entry.name, entry.kind, entry.source, entry.dest,
                entry.size, entry.status, entry.method, entry.error, entry.finished_at
            ],
        )?;
        conn.execute(
            "DELETE FROM history WHERE rowid NOT IN
                (SELECT rowid FROM history ORDER BY finished_at DESC LIMIT 500)",
            [],
        )?;
        Ok(())
    }

    pub fn list_history(&self) -> AppResult<Vec<HistoryEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, kind, source, dest, size, status, method, error, finished_at
             FROM history ORDER BY finished_at DESC LIMIT 500",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(HistoryEntry {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                source: r.get(3)?,
                dest: r.get(4)?,
                size: r.get(5)?,
                status: r.get(6)?,
                method: r.get(7)?,
                error: r.get(8)?,
                finished_at: r.get(9)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn clear_history(&self) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM history", [])?;
        Ok(())
    }

    // ---------- settings ----------

    pub fn load_settings(&self) -> Settings {
        let conn = self.conn.lock();
        let raw: Option<String> = conn
            .query_row("SELECT v FROM kv WHERE k = 'settings'", [], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        let mut settings = raw
            .and_then(|v| serde_json::from_str::<Settings>(&v).ok())
            .unwrap_or_default();
        settings.sanitize();
        settings
    }

    pub fn save_settings(&self, settings: &Settings) -> AppResult<()> {
        let conn = self.conn.lock();
        let json = serde_json::to_string(settings)?;
        conn.execute(
            "INSERT INTO kv (k, v) VALUES ('settings', ?1)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![json],
        )?;
        Ok(())
    }

    /// Tab layout persisted across restarts (profile id + remote path).
    pub fn load_open_tabs(&self) -> Vec<(String, String)> {
        let conn = self.conn.lock();
        let raw: Option<String> = conn
            .query_row("SELECT v FROM kv WHERE k = 'open_tabs'", [], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        raw.and_then(|v| serde_json::from_str::<Vec<(String, String)>>(&v).ok())
            .unwrap_or_default()
    }

    pub fn save_open_tabs(&self, tabs: &[(String, String)]) -> AppResult<()> {
        let conn = self.conn.lock();
        let json = serde_json::to_string(tabs)?;
        conn.execute(
            "INSERT INTO kv (k, v) VALUES ('open_tabs', ?1)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![json],
        )?;
        Ok(())
    }

    pub fn reset_all(&self) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute_batch(
            "DELETE FROM secrets; DELETE FROM known_hosts; DELETE FROM favorites;
             DELETE FROM recent; DELETE FROM history; DELETE FROM kv;",
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> Db {
        let dir = std::env::temp_dir().join(format!("swiftsftp-test-{}", uuid::Uuid::new_v4()));
        Db::open(&dir.join("test.db")).expect("open db")
    }

    fn profile(id: &str) -> Profile {
        Profile {
            id: id.into(),
            name: "Test".into(),
            group_name: "Production".into(),
            host: "example.com".into(),
            port: 2222,
            username: "root".into(),
            auth_method: "password".into(),
            color: None,
            key_path: None,
            default_remote_dir: Some("/srv".into()),
            timeout_secs: 20,
            keepalive_secs: 30,
            auto_connect: false,
            last_dir: None,
            has_password: false,
            has_passphrase: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn saves_and_loads_profiles() {
        let db = temp_db();
        db.save_profile(&profile("p1")).unwrap();
        let all = db.list_profiles().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].port, 2222);
        assert_eq!(all[0].default_remote_dir.as_deref(), Some("/srv"));
    }

    #[test]
    fn profile_upsert_keeps_last_dir() {
        let db = temp_db();
        db.save_profile(&profile("p1")).unwrap();
        db.set_last_dir("p1", "/home/user").unwrap();
        let mut p = profile("p1");
        p.last_dir = None;
        p.name = "Renamed".into();
        db.save_profile(&p).unwrap();
        let loaded = db.get_profile("p1").unwrap().unwrap();
        assert_eq!(loaded.name, "Renamed");
        assert_eq!(loaded.last_dir.as_deref(), Some("/home/user"));
    }

    #[test]
    fn known_hosts_are_upserted_per_algorithm() {
        let db = temp_db();
        db.trust_host("h", 22, "ssh-ed25519", "SHA256:aaa", "blob")
            .unwrap();
        db.trust_host("h", 22, "ssh-ed25519", "SHA256:bbb", "blob2")
            .unwrap();
        let hosts = db.known_hosts_for("h", 22).unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].fingerprint, "SHA256:bbb");
    }

    #[test]
    fn settings_round_trip_and_clamp() {
        let db = temp_db();
        let s = Settings {
            max_concurrent_transfers: 999,
            ..Default::default()
        };
        db.save_settings(&s).unwrap();
        let loaded = db.load_settings();
        assert_eq!(loaded.max_concurrent_transfers, 16);
    }

    #[test]
    fn deleting_profile_removes_secret() {
        let db = temp_db();
        db.save_profile(&profile("p1")).unwrap();
        db.set_secret("p1", "password", "blob").unwrap();
        assert!(db.get_secret_blob("p1", "password").unwrap().is_some());
        db.delete_profile("p1").unwrap();
        assert!(db.get_secret_blob("p1", "password").unwrap().is_none());
    }
}

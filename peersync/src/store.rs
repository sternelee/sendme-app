use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::config::project_dirs;
use crate::history::{SyncAction, SyncRecord};

/// Path to the local SQLite database.
///
/// If `data_dir` is provided it is used; otherwise `config_dir` is used as a
/// fallback. When neither is given the platform-specific project data dir is
/// used (`~/.local/share/peersync/peersync.db` on Linux).
pub fn db_path(config_dir: Option<&Path>, data_dir: Option<&Path>) -> Result<PathBuf> {
    if let Some(dir) = data_dir {
        Ok(dir.join("peersync.db"))
    } else if let Some(dir) = config_dir {
        Ok(dir.join("peersync.db"))
    } else {
        let dirs = project_dirs()?;
        Ok(dirs.data_dir().to_path_buf().join("peersync.db"))
    }
}

/// Local SQLite store for history, tombstones, and peer state.
///
/// Uses `std::sync::Mutex` (not `tokio::sync::Mutex`) because all SQLite
/// operations via `rusqlite` are synchronous and complete in microseconds.
/// `tokio::sync::Mutex` would add unnecessary async overhead without
/// benefit. The mutex is held only for the duration of each short query; it
/// never blocks across an `.await` point so it cannot stall the async runtime.
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Open or create the store at the given path.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating db dir {}", parent.display()))?;
        }
        let conn =
            Connection::open(path).with_context(|| format!("opening db at {}", path.display()))?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.init_tables()?;
        Ok(store)
    }

    fn init_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sync_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp_ms INTEGER NOT NULL,
                device_name TEXT NOT NULL,
                node_id TEXT NOT NULL,
                target_key TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                action TEXT NOT NULL,
                file_hash TEXT,
                size INTEGER,
                updated_at_ms INTEGER,
                details TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_history_time ON sync_history(timestamp_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_history_path ON sync_history(target_key, relative_path);

            CREATE TABLE IF NOT EXISTS tombstones (
                target_key TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                deleted_at_ms INTEGER NOT NULL,
                PRIMARY KEY (target_key, relative_path)
            );

            CREATE TABLE IF NOT EXISTS peers (
                node_id TEXT PRIMARY KEY,
                first_seen_ms INTEGER NOT NULL,
                last_seen_ms INTEGER NOT NULL,
                online INTEGER NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            
            PRAGMA journal_mode = WAL;
            
            -- Migration: add retention-tracking columns if upgrading from older schema
            -- (SQLite ignores unsupported ALTER, so we keep schema additive)
            
            -- Ensure indices exist
            CREATE INDEX IF NOT EXISTS idx_history_action ON sync_history(action);
            
            PRAGMA foreign_keys = OFF;
            
            -- No foreign keys; simple key-value + log tables
            
            PRAGMA foreign_keys = ON;
            
            ",
        )
        .context("initializing tables")?;
        Ok(())
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Insert a sync history record.
    pub fn insert_history(&self, record: &SyncRecord) -> Result<()> {
        self.conn()
            .execute(
                "INSERT INTO sync_history
                 (timestamp_ms, device_name, node_id, target_key, relative_path, action, file_hash, size, updated_at_ms, details)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    record.timestamp_ms as i64,
                    record.device_name,
                    record.node_id,
                    record.target_key,
                    record.relative_path,
                    record.action.as_str(),
                    record.file_hash,
                    record.size.map(|s| s as i64),
                    record.updated_at_ms.map(|t| t as i64),
                    record.details,
                ],
            )
            .context("inserting history record")?;
        Ok(())
    }

    /// Count history records older than a timestamp.
    pub fn count_history_older_than(&self, older_than_ms: u64) -> Result<usize> {
        let conn = self.conn();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_history WHERE timestamp_ms < ?1",
                params![older_than_ms as i64],
                |row| row.get(0),
            )
            .context("counting old history records")?;
        Ok(count as usize)
    }

    /// Query sync history with optional filters.
    pub fn query_history(
        &self,
        target_key: Option<&str>,
        action: Option<SyncAction>,
        since_ms: Option<u64>,
        limit: usize,
    ) -> Result<Vec<SyncRecord>> {
        let mut sql = String::from(
            "SELECT timestamp_ms, device_name, node_id, target_key, relative_path, action,
                    file_hash, size, updated_at_ms, details
             FROM sync_history WHERE 1=1",
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(tk) = target_key {
            sql.push_str(" AND target_key = ?");
            params_vec.push(Box::new(tk.to_string()));
        }
        if let Some(a) = action {
            sql.push_str(" AND action = ?");
            params_vec.push(Box::new(a.as_str().to_string()));
        }
        if let Some(s) = since_ms {
            sql.push_str(" AND timestamp_ms >= ?");
            params_vec.push(Box::new(s as i64));
        }
        sql.push_str(" ORDER BY timestamp_ms DESC LIMIT ?");
        params_vec.push(Box::new(limit as i64));

        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let conn = self.conn();
        let mut stmt = conn.prepare(&sql).context("preparing history query")?;
        let rows = stmt
            .query_map(&param_refs[..], |row| {
                Ok(SyncRecord {
                    timestamp_ms: row.get::<_, i64>(0)? as u64,
                    device_name: row.get(1)?,
                    node_id: row.get(2)?,
                    target_key: row.get(3)?,
                    relative_path: row.get(4)?,
                    action: SyncAction::parse_str(&row.get::<_, String>(5)?)
                        .unwrap_or(SyncAction::LocalUpload),
                    file_hash: row.get(6)?,
                    size: row.get::<_, Option<i64>>(7)?.map(|s| s as u64),
                    updated_at_ms: row.get::<_, Option<i64>>(8)?.map(|t| t as u64),
                    details: row.get(9)?,
                })
            })
            .context("mapping history rows")?;

        let mut records = Vec::new();
        for row in rows {
            records.push(row.context("reading history row")?);
        }
        Ok(records)
    }

    /// Delete history records older than the given retention.
    pub fn prune_history(&self, older_than_ms: u64) -> Result<usize> {
        let n = self
            .conn()
            .execute(
                "DELETE FROM sync_history WHERE timestamp_ms < ?1",
                params![older_than_ms as i64],
            )
            .context("pruning history")?;
        Ok(n)
    }

    /// Upsert a tombstone record.
    pub fn upsert_tombstone(
        &self,
        target_key: &str,
        relative_path: &str,
        deleted_at_ms: u64,
    ) -> Result<()> {
        self.conn()
            .execute(
                "INSERT INTO tombstones (target_key, relative_path, deleted_at_ms)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(target_key, relative_path) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms",
                params![target_key, relative_path, deleted_at_ms as i64],
            )
            .context("upserting tombstone")?;
        Ok(())
    }

    /// List all tombstones older than the given timestamp.
    pub fn list_old_tombstones(&self, older_than_ms: u64) -> Result<Vec<(String, String, u64)>> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare(
                "SELECT target_key, relative_path, deleted_at_ms
                 FROM tombstones WHERE deleted_at_ms < ?1",
            )
            .context("preparing tombstone query")?;
        let rows = stmt
            .query_map(params![older_than_ms as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? as u64,
                ))
            })
            .context("mapping tombstone rows")?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("collecting tombstone rows")
    }

    /// Delete tombstones older than the given timestamp.
    pub fn prune_tombstones(&self, older_than_ms: u64) -> Result<usize> {
        let n = self
            .conn()
            .execute(
                "DELETE FROM tombstones WHERE deleted_at_ms < ?1",
                params![older_than_ms as i64],
            )
            .context("pruning tombstones")?;
        Ok(n)
    }

    /// Upsert a peer record.
    pub fn upsert_peer(&self, node_id: &str, online: bool, seen_ms: u64) -> Result<()> {
        let online_i: i64 = if online { 1 } else { 0 };
        self.conn()
            .execute(
                "INSERT INTO peers (node_id, first_seen_ms, last_seen_ms, online)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(node_id) DO UPDATE SET
                     first_seen_ms = CASE WHEN first_seen_ms > excluded.first_seen_ms THEN excluded.first_seen_ms ELSE first_seen_ms END,
                     last_seen_ms = excluded.last_seen_ms,
                     online = excluded.online",
                params![node_id, seen_ms as i64, seen_ms as i64, online_i],
            )
            .context("upserting peer")?;
        Ok(())
    }

    /// List all known peers.
    pub fn list_peers(&self) -> Result<Vec<PeerInfo>> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare(
                "SELECT node_id, first_seen_ms, last_seen_ms, online FROM peers ORDER BY last_seen_ms DESC",
            )
            .context("preparing peer query")?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PeerInfo {
                    node_id: row.get(0)?,
                    first_seen_ms: row.get::<_, i64>(1)? as u64,
                    last_seen_ms: row.get::<_, i64>(2)? as u64,
                    online: row.get::<_, i64>(3)? != 0,
                })
            })
            .context("mapping peer rows")?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("collecting peer rows")
    }

    /// Get the value of a sync state key.
    pub fn get_state(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare("SELECT value FROM sync_state WHERE key = ?1")
            .context("preparing state query")?;
        stmt.query_row(params![key], |row| row.get(0))
            .optional()
            .context("reading state key")
    }

    /// Set a sync state key.
    pub fn set_state(&self, key: &str, value: &str) -> Result<()> {
        self.conn()
            .execute(
                "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .context("setting state key")?;
        Ok(())
    }
}

/// Peer information persisted locally.
#[derive(Debug, Clone)]
pub struct PeerInfo {
    pub node_id: String,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    pub online: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_record() -> SyncRecord {
        SyncRecord {
            timestamp_ms: 1000,
            device_name: "dev".to_string(),
            node_id: "node".to_string(),
            target_key: "nvim".to_string(),
            relative_path: "init.lua".to_string(),
            action: SyncAction::LocalUpload,
            file_hash: Some("b3_abc".to_string()),
            size: Some(123),
            updated_at_ms: Some(999),
            details: None,
        }
    }

    #[test]
    fn test_history_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let store = Store::open(&tmp.path().join("test.db")).unwrap();
        let rec = sample_record();
        store.insert_history(&rec).unwrap();
        let rows = store.query_history(None, None, None, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].relative_path, "init.lua");
    }

    #[test]
    fn test_tombstone_and_prune() {
        let tmp = TempDir::new().unwrap();
        let store = Store::open(&tmp.path().join("test.db")).unwrap();
        store.upsert_tombstone("nvim", "old.lua", 100).unwrap();
        store.upsert_tombstone("nvim", "new.lua", 2000).unwrap();
        let old = store.list_old_tombstones(1500).unwrap();
        assert_eq!(old.len(), 1);
        assert_eq!(old[0].1, "old.lua");
        let n = store.prune_tombstones(1500).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn test_peer_upsert() {
        let tmp = TempDir::new().unwrap();
        let store = Store::open(&tmp.path().join("test.db")).unwrap();
        store.upsert_peer("peer1", true, 1000).unwrap();
        store.upsert_peer("peer1", false, 2000).unwrap();
        let peers = store.list_peers().unwrap();
        assert_eq!(peers.len(), 1);
        assert!(!peers[0].online);
        assert_eq!(peers[0].first_seen_ms, 1000);
    }
}

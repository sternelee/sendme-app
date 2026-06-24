use anyhow::{Context, Result};
use std::path::Path;

use crate::store::{db_path, Store};

/// Action type for a sync history record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncAction {
    LocalUpload,
    RemoteApply,
    RemoteDelete,
    ConflictBackup,
    TombstonePublished,
    SyncCompleted,
    NeighborUp,
    NeighborDown,
}

impl SyncAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncAction::LocalUpload => "local_upload",
            SyncAction::RemoteApply => "remote_apply",
            SyncAction::RemoteDelete => "remote_delete",
            SyncAction::ConflictBackup => "conflict_backup",
            SyncAction::TombstonePublished => "tombstone_published",
            SyncAction::SyncCompleted => "sync_completed",
            SyncAction::NeighborUp => "neighbor_up",
            SyncAction::NeighborDown => "neighbor_down",
        }
    }

    pub fn parse_str(s: &str) -> Option<Self> {
        match s {
            "local_upload" => Some(SyncAction::LocalUpload),
            "remote_apply" => Some(SyncAction::RemoteApply),
            "remote_delete" => Some(SyncAction::RemoteDelete),
            "conflict_backup" => Some(SyncAction::ConflictBackup),
            "tombstone_published" => Some(SyncAction::TombstonePublished),
            "sync_completed" => Some(SyncAction::SyncCompleted),
            "neighbor_up" => Some(SyncAction::NeighborUp),
            "neighbor_down" => Some(SyncAction::NeighborDown),
            _ => None,
        }
    }
}

/// A single audit log record.
#[derive(Debug, Clone)]
pub struct SyncRecord {
    pub timestamp_ms: u64,
    pub device_name: String,
    pub node_id: String,
    pub target_key: String,
    pub relative_path: String,
    pub action: SyncAction,
    pub file_hash: Option<String>,
    pub size: Option<u64>,
    pub updated_at_ms: Option<u64>,
    pub details: Option<String>,
}

/// High-level history API.
pub struct History {
    pub(crate) store: Store,
}

impl History {
    /// Open the history store.
    ///
    /// `config_dir` controls where the SQLite database lives when `data_dir` is
    /// not provided. Pass `data_dir` to keep the database separate from the
    /// configuration directory.
    pub fn open(config_dir: Option<&Path>, data_dir: Option<&Path>) -> Result<Self> {
        let path = db_path(config_dir, data_dir).context("opening history store")?;
        let store = Store::open(&path).context("opening history store")?;
        Ok(Self { store })
    }

    /// Open from an existing Store.
    pub fn from_store(store: Store) -> Self {
        Self { store }
    }

    /// Record a sync event.
    pub fn log(&self, record: SyncRecord) -> Result<()> {
        self.store.insert_history(&record).context("logging record")
    }

    /// Query history records.
    pub fn query(
        &self,
        target_key: Option<&str>,
        action: Option<SyncAction>,
        since_ms: Option<u64>,
        limit: usize,
    ) -> Result<Vec<SyncRecord>> {
        self.store
            .query_history(target_key, action, since_ms, limit)
            .context("querying history")
    }

    /// Prune history older than the given timestamp.
    pub fn prune(&self, older_than_ms: u64) -> Result<usize> {
        self.store
            .prune_history(older_than_ms)
            .context("pruning history")
    }

    /// Record a tombstone for GC tracking.
    pub fn record_tombstone(
        &self,
        target_key: &str,
        relative_path: &str,
        deleted_at_ms: u64,
    ) -> Result<()> {
        self.store
            .upsert_tombstone(target_key, relative_path, deleted_at_ms)
            .context("recording tombstone")
    }

    /// List tombstones older than the given timestamp.
    pub fn old_tombstones(&self, older_than_ms: u64) -> Result<Vec<(String, String, u64)>> {
        self.store
            .list_old_tombstones(older_than_ms)
            .context("listing old tombstones")
    }

    /// Prune tombstones older than the given timestamp.
    pub fn prune_tombstones(&self, older_than_ms: u64) -> Result<usize> {
        self.store
            .prune_tombstones(older_than_ms)
            .context("pruning tombstones")
    }

    /// Return the timestamp (ms) of the last GC run, if any.
    pub fn last_gc_ms(&self) -> Result<Option<u64>> {
        self.store
            .get_state("last_gc_ms")
            .context("reading last gc time")
            .map(|opt| opt.and_then(|s| s.parse().ok()))
    }

    /// Persist the timestamp (ms) of the last GC run.
    pub fn set_last_gc_ms(&self, ms: u64) -> Result<()> {
        self.store
            .set_state("last_gc_ms", &ms.to_string())
            .context("writing last gc time")
    }

    /// Count history records older than the given timestamp.
    pub fn count_history_older_than(&self, older_than_ms: u64) -> Result<usize> {
        self.store
            .count_history_older_than(older_than_ms)
            .context("counting old history records")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_history_log_and_query() {
        let tmp = TempDir::new().unwrap();
        let history = History::open(Some(tmp.path()), None).unwrap();
        history
            .log(SyncRecord {
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
            })
            .unwrap();

        let rows = history.query(Some("nvim"), None, None, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].action, SyncAction::LocalUpload);
    }
}

use anyhow::{Context, Result};
use futures_lite::StreamExt;
use iroh_docs::engine::LiveEvent;
use iroh_docs::{AuthorId, NamespaceId};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::{expand_path, Config, TargetConfig};
use crate::fs::{
    atomic_write, backup_existing_file, compute_hash_bytes, file_mtime_ms, is_ignored, now_ms,
    parse_hash, read_file,
};
use crate::gc;
use crate::history::{History, SyncAction, SyncRecord};
use crate::metadata::{parse_doc_key, FileMetadata};
use crate::network::Network;
use crate::state::{save_state, State};
use crate::watcher::{FsEvent, FsEventKind, TargetWatcher};

/// In-flight remote write marker used to break the echo loop.
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct InFlightKey {
    target_key: String,
    relative_path: String,
    updated_at: u64,
}

/// Pending file download waiting for ContentReady.
#[derive(Debug, Clone)]
struct PendingDownload {
    target_key: String,
    relative_path: String,
    meta: FileMetadata,
}

/// The central sync engine.
pub struct SyncEngine {
    config: Config,
    namespace: NamespaceId,
    author: AuthorId,
    network: Network,
    history: Arc<History>,
    ticket: Option<String>,
    in_flight: Arc<RwLock<HashSet<InFlightKey>>>,
    pending: Arc<RwLock<Vec<PendingDownload>>>,
    node_id: String,
    device_name: String,
}

impl SyncEngine {
    /// Start the engine, loading state and opening the doc.
    pub async fn start(
        config: Config,
        config_dir: Option<PathBuf>,
        data_dir: Option<PathBuf>,
        mut state: State,
    ) -> Result<Self> {
        let network = Network::start(config_dir.as_deref(), data_dir.as_deref(), &state).await?;
        let history = Arc::new(
            History::open(config_dir.as_deref(), data_dir.as_deref()).context("opening history")?,
        );

        // Ensure we have a namespace.
        let namespace = if let Some(ns_hex) = &state.namespace_id {
            ns_hex
                .parse::<NamespaceId>()
                .context("parsing namespace id")?
        } else {
            let ns = network.create_doc().await?;
            state.namespace_id = Some(ns.to_string());
            save_state(config_dir.as_deref(), &state)?;
            ns
        };

        // Ensure we have an author.
        let author = network.default_author().await?;
        state.author_id = Some(author.to_string());

        // Ensure we have a persistent doc ticket for linking other devices.
        // Reuse the existing ticket if one is already stored in state.
        let ticket = if let Some(t) = state.ticket.clone() {
            Some(t)
        } else {
            let t = network.share_doc(namespace).await?;
            state.ticket = Some(t.clone());
            Some(t)
        };

        save_state(config_dir.as_deref(), &state)?;

        let node_id = network.endpoint.secret_key().public().to_string();
        let device_name = state.device_name.clone();

        Ok(Self {
            config,
            namespace,
            author,
            network,
            history,
            ticket,
            in_flight: Arc::new(RwLock::new(HashSet::new())),
            pending: Arc::new(RwLock::new(Vec::new())),
            node_id,
            device_name,
        })
    }

    /// Run the engine: scan local targets, start watcher, listen for remote events.
    pub async fn run(self) -> Result<()> {
        let engine = Arc::new(self);

        // Initial upload of local state.
        engine.scan_and_upload_all().await?;

        let mut watcher = TargetWatcher::start(&engine.config.targets)?;
        let doc = engine.network.open_doc(engine.namespace).await?;
        let mut events = doc.subscribe().await.context("subscribing to doc events")?;

        // Start periodic GC task.
        let gc_engine = engine.clone();
        let gc_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(24 * 60 * 60));
            loop {
                interval.tick().await;
                if let Err(e) = gc_engine.run_gc(30, false).await {
                    tracing::warn!(error = %e, "periodic GC failed");
                }
            }
        });

        tracing::info!("peersync engine running");

        loop {
            tokio::select! {
                Some(batch) = watcher.recv() => {
                    for event in batch {
                        if let Err(e) = engine.handle_local_event(event).await {
                            tracing::warn!(error = %e, "handling local event failed");
                        }
                    }
                }
                Some(event) = events.next() => {
                    let event = event.context("doc event stream error")?;
                    if let Err(e) = engine.handle_remote_event(event).await {
                        tracing::warn!(error = %e, "handling remote event failed");
                    }
                }
                else => break,
            }
        }

        gc_handle.abort();
        Ok(())
    }

    /// Run GC manually.
    pub async fn run_gc(
        self: &Arc<Self>,
        retention_days: u64,
        dry_run: bool,
    ) -> Result<gc::GcReport> {
        gc::run_gc(&self.config, &self.history, retention_days, dry_run)
    }

    /// Return the persisted shareable doc ticket for this sync namespace.
    pub fn ticket(&self) -> Option<String> {
        self.ticket.clone()
    }

    /// Scan all targets and upload missing/changed files.
    async fn scan_and_upload_all(self: &Arc<Self>) -> Result<()> {
        for (target_key, target) in &self.config.targets {
            let src = expand_path(&target.src)?;
            if !src.exists() {
                continue;
            }
            self.scan_target(target_key, target, &src).await?;
        }
        Ok(())
    }

    async fn scan_target(&self, target_key: &str, target: &TargetConfig, src: &Path) -> Result<()> {
        let mut entries = tokio::fs::read_dir(src).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let relative = path.strip_prefix(src)?.to_string_lossy().replace('\\', "/");
            if is_ignored(&relative, &target.ignore) {
                continue;
            }
            let meta = entry.metadata().await?;
            if meta.is_dir() {
                Box::pin(self.scan_target(target_key, target, &path)).await?;
            } else if meta.is_file() {
                self.upload_file(target_key, &relative, &path).await?;
            }
        }
        Ok(())
    }

    /// Handle a local filesystem event.
    async fn handle_local_event(self: &Arc<Self>, event: FsEvent) -> Result<()> {
        let key = InFlightKey {
            target_key: event.target_key.clone(),
            relative_path: event.relative_path.clone(),
            updated_at: now_ms(),
        };

        // Ignore events caused by our own remote writes.
        {
            let mut in_flight = self.in_flight.write().await;
            if in_flight.remove(&key) {
                tracing::debug!(target = %event.target_key, path = %event.relative_path, "ignoring echo event");
                return Ok(());
            }
        }

        match event.kind {
            FsEventKind::Remove => {
                self.publish_tombstone(&event.target_key, &event.relative_path)
                    .await?;
            }
            _ => {
                if event.absolute_path.exists() {
                    self.upload_file(
                        &event.target_key,
                        &event.relative_path,
                        &event.absolute_path,
                    )
                    .await?;
                }
            }
        }
        Ok(())
    }

    /// Upload a single file to the doc.
    async fn upload_file(&self, target_key: &str, relative: &str, path: &Path) -> Result<()> {
        let data = read_file(path)?;
        let mtime = file_mtime_ms(path)?;
        let file_hash = compute_hash_bytes(&data);

        // Import into blob store.
        let hash = parse_hash(&file_hash)?;
        let tag_info = self
            .network
            .blobs
            .add_bytes(data.clone())
            .with_tag()
            .await
            .context("adding file to blobs")?;
        assert_eq!(tag_info.hash, hash, "computed hash mismatch");

        let meta = FileMetadata {
            relative_path: relative.to_string(),
            target_key: target_key.to_string(),
            file_hash: file_hash.clone(),
            size: data.len() as u64,
            updated_at: mtime,
            last_modified_by: self.node_id.clone(),
            is_deleted: false,
        };

        let doc = self.network.open_doc(self.namespace).await?;
        doc.set_bytes(self.author, meta.doc_key(), meta.to_bytes()?)
            .await
            .context("setting doc metadata")?;

        self.history.log(SyncRecord {
            timestamp_ms: now_ms(),
            device_name: self.device_name.clone(),
            node_id: self.node_id.clone(),
            target_key: target_key.to_string(),
            relative_path: relative.to_string(),
            action: SyncAction::LocalUpload,
            file_hash: Some(file_hash.clone()),
            size: Some(data.len() as u64),
            updated_at_ms: Some(mtime),
            details: None,
        })?;

        tracing::info!(target = %target_key, path = %relative, hash = %file_hash, "uploaded file");
        Ok(())
    }

    /// Publish a deletion marker.
    async fn publish_tombstone(&self, target_key: &str, relative: &str) -> Result<()> {
        let meta = FileMetadata {
            relative_path: relative.to_string(),
            target_key: target_key.to_string(),
            file_hash: "b3_".to_string() + &"0".repeat(64),
            size: 0,
            updated_at: now_ms(),
            last_modified_by: self.node_id.clone(),
            is_deleted: true,
        };
        let doc = self.network.open_doc(self.namespace).await?;
        doc.set_bytes(self.author, meta.doc_key(), meta.to_bytes()?)
            .await
            .context("publishing tombstone")?;

        self.history.log(SyncRecord {
            timestamp_ms: now_ms(),
            device_name: self.device_name.clone(),
            node_id: self.node_id.clone(),
            target_key: target_key.to_string(),
            relative_path: relative.to_string(),
            action: SyncAction::TombstonePublished,
            file_hash: None,
            size: None,
            updated_at_ms: Some(meta.updated_at),
            details: None,
        })?;

        tracing::info!(target = %target_key, path = %relative, "published tombstone");
        Ok(())
    }

    /// Handle a remote doc event.
    async fn handle_remote_event(self: &Arc<Self>, event: LiveEvent) -> Result<()> {
        match event {
            LiveEvent::InsertLocal { .. } => {
                // Ignore our own local writes to avoid double-processing.
                return Ok(());
            }
            LiveEvent::InsertRemote { entry, .. } => {
                let key = String::from_utf8_lossy(entry.key());
                let (target_key, relative) =
                    parse_doc_key(&key).with_context(|| format!("parsing doc key {}", key))?;

                // Read metadata from blob store.
                let hash = entry.content_hash();
                let size = entry.content_len();
                let meta = if size == 0 {
                    FileMetadata {
                        relative_path: relative.clone(),
                        target_key: target_key.clone(),
                        file_hash: format!("b3_{}", "0".repeat(64)),
                        size: 0,
                        updated_at: entry.timestamp(),
                        last_modified_by: "unknown".to_string(),
                        is_deleted: true,
                    }
                } else {
                    let meta_bytes = self.read_blob_bytes(hash).await?;
                    FileMetadata::from_bytes(&meta_bytes)?
                };

                if self.network.blobs.has(hash).await? {
                    // Content already available locally.
                    if meta.is_deleted {
                        self.apply_remote_delete(&target_key, &relative, meta.updated_at)
                            .await?;
                    } else {
                        self.apply_remote_file(&target_key, &relative, &meta)
                            .await?;
                    }
                } else {
                    // Wait for ContentReady.
                    self.pending.write().await.push(PendingDownload {
                        target_key,
                        relative_path: relative,
                        meta,
                    });
                }
            }
            LiveEvent::ContentReady { hash } => {
                self.process_pending(hash).await?;
            }
            LiveEvent::NeighborUp(pk) => {
                let node_id = pk.to_string();
                if let Err(e) = self
                    .history
                    .store
                    .upsert_peer(&node_id, true, now_ms())
                    .context("upserting peer")
                {
                    tracing::warn!(error = %e, "failed to record neighbor up");
                }
                self.history.log(SyncRecord {
                    timestamp_ms: now_ms(),
                    device_name: self.device_name.clone(),
                    node_id: node_id.clone(),
                    target_key: String::new(),
                    relative_path: String::new(),
                    action: SyncAction::NeighborUp,
                    file_hash: None,
                    size: None,
                    updated_at_ms: None,
                    details: None,
                })?;
            }
            LiveEvent::NeighborDown(pk) => {
                let node_id = pk.to_string();
                if let Err(e) = self
                    .history
                    .store
                    .upsert_peer(&node_id, false, now_ms())
                    .context("upserting peer")
                {
                    tracing::warn!(error = %e, "failed to record neighbor down");
                }
                self.history.log(SyncRecord {
                    timestamp_ms: now_ms(),
                    device_name: self.device_name.clone(),
                    node_id: node_id.clone(),
                    target_key: String::new(),
                    relative_path: String::new(),
                    action: SyncAction::NeighborDown,
                    file_hash: None,
                    size: None,
                    updated_at_ms: None,
                    details: None,
                })?;
            }
            LiveEvent::SyncFinished(ev) => {
                self.history.log(SyncRecord {
                    timestamp_ms: now_ms(),
                    device_name: self.device_name.clone(),
                    node_id: ev.peer.to_string(),
                    target_key: String::new(),
                    relative_path: String::new(),
                    action: SyncAction::SyncCompleted,
                    file_hash: None,
                    size: None,
                    updated_at_ms: None,
                    details: Some(format!("origin={:?} result={:?}", ev.origin, ev.result)),
                })?;
            }
            _ => {}
        }
        Ok(())
    }

    /// Process any pending downloads whose metadata or content hash matches.
    async fn process_pending(self: &Arc<Self>, hash: iroh_blobs::Hash) -> Result<()> {
        let mut pending = self.pending.write().await;
        let mut i = 0;
        while i < pending.len() {
            let should_apply = {
                let p = &pending[i];
                if parse_hash(&p.meta.file_hash).ok() == Some(hash) {
                    // Content blob ready.
                    true
                } else {
                    // Could be metadata blob ready; try reading metadata.
                    match self.read_blob_bytes(hash).await {
                        Ok(bytes) => {
                            if let Ok(meta) = FileMetadata::from_bytes(&bytes) {
                                meta.target_key == p.target_key
                                    && meta.relative_path == p.relative_path
                            } else {
                                false
                            }
                        }
                        Err(_) => false,
                    }
                }
            };

            if should_apply {
                let p = pending.remove(i);
                drop(pending);
                if p.meta.is_deleted {
                    self.apply_remote_delete(&p.target_key, &p.relative_path, p.meta.updated_at)
                        .await?;
                } else {
                    self.apply_remote_file(&p.target_key, &p.relative_path, &p.meta)
                        .await?;
                }
                pending = self.pending.write().await;
            } else {
                i += 1;
            }
        }
        Ok(())
    }

    /// Read all bytes of a blob from the local store.
    async fn read_blob_bytes(&self, hash: iroh_blobs::Hash) -> Result<Vec<u8>> {
        let bytes = self.network.blobs.get_bytes(hash).await?;
        Ok(bytes.to_vec())
    }

    /// Apply a remote file update to the local filesystem.
    async fn apply_remote_file(
        self: &Arc<Self>,
        target_key: &str,
        relative: &str,
        meta: &FileMetadata,
    ) -> Result<()> {
        let target = self
            .config
            .targets
            .get(target_key)
            .with_context(|| format!("unknown target {}", target_key))?;
        let src = expand_path(&target.src)?;
        let local_path = src.join(relative);

        // Conflict detection: if local file is newer, keep it.
        if local_path.exists() {
            let local_mtime = file_mtime_ms(&local_path)?;
            if local_mtime >= meta.updated_at {
                tracing::info!(target = %target_key, path = %relative, "local file is newer or equal, skipping remote");
                return Ok(());
            }
        }

        // Register in-flight so our own Watcher ignores the subsequent write.
        let key = InFlightKey {
            target_key: target_key.to_string(),
            relative_path: relative.to_string(),
            updated_at: meta.updated_at,
        };
        self.in_flight.write().await.insert(key);

        // Download content.
        let hash = parse_hash(&meta.file_hash)?;
        let content = self.read_blob_bytes(hash).await?;

        // Backup existing file before overwriting.
        let backup_created = backup_existing_file(&local_path, &self.device_name)?;
        if let Some(ref backup) = backup_created {
            tracing::warn!(backup = %backup.display(), "conflict backup created");
        }

        atomic_write(&local_path, &content)?;

        self.history.log(SyncRecord {
            timestamp_ms: now_ms(),
            device_name: self.device_name.clone(),
            node_id: self.node_id.clone(),
            target_key: target_key.to_string(),
            relative_path: relative.to_string(),
            action: SyncAction::RemoteApply,
            file_hash: Some(meta.file_hash.clone()),
            size: Some(meta.size),
            updated_at_ms: Some(meta.updated_at),
            details: None,
        })?;

        if let Some(backup) = backup_created {
            self.history.log(SyncRecord {
                timestamp_ms: now_ms(),
                device_name: self.device_name.clone(),
                node_id: self.node_id.clone(),
                target_key: target_key.to_string(),
                relative_path: relative.to_string(),
                action: SyncAction::ConflictBackup,
                file_hash: None,
                size: None,
                updated_at_ms: Some(meta.updated_at),
                details: Some(backup.display().to_string()),
            })?;
        }

        tracing::info!(target = %target_key, path = %relative, "applied remote file");
        Ok(())
    }

    /// Apply a remote deletion.
    async fn apply_remote_delete(
        self: &Arc<Self>,
        target_key: &str,
        relative: &str,
        updated_at: u64,
    ) -> Result<()> {
        let target = self
            .config
            .targets
            .get(target_key)
            .with_context(|| format!("unknown target {}", target_key))?;
        let src = expand_path(&target.src)?;
        let local_path = src.join(relative);

        if local_path.exists() {
            let local_mtime = file_mtime_ms(&local_path)?;
            if local_mtime > updated_at {
                tracing::info!(target = %target_key, path = %relative, "local file modified after remote delete, keeping");
                return Ok(());
            }
            std::fs::remove_file(&local_path)
                .with_context(|| format!("deleting {}", local_path.display()))?;
            tracing::info!(target = %target_key, path = %relative, "applied remote delete");
        }

        self.history.log(SyncRecord {
            timestamp_ms: now_ms(),
            device_name: self.device_name.clone(),
            node_id: self.node_id.clone(),
            target_key: target_key.to_string(),
            relative_path: relative.to_string(),
            action: SyncAction::RemoteDelete,
            file_hash: None,
            size: None,
            updated_at_ms: Some(updated_at),
            details: None,
        })?;
        self.history
            .record_tombstone(target_key, relative, updated_at)?;

        Ok(())
    }
}

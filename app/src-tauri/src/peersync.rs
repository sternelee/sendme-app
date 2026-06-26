//! Tauri bindings for the peersync crate.
//!
//! Owns one shared [`PeerSyncRuntime`] inside the Tauri app state. Commands
//! are thin wrappers around the engine API; heavy lifting stays in
//! `peersync::engine` so the same engine is reusable from the CLI TUI.
//!
//! Storage layout (under `app_data_dir()/peersync`):
//!   `config.toml`, `state.toml`, `peersync.db` (sqlite), `iroh-data/` (blobs + docs).

use peersync::{
    config::Config,
    engine::SyncEngine,
    gc::GcReport,
    history::{History, SyncRecord},
    status::StatusInfo,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::RwLock;

use anyhow::Context as _;

/// Shared peersync runtime state.
pub type PeerSyncState = Arc<RwLock<PeerSyncRuntime>>;

/// Per-app mutable state for the peersync engine.
pub struct PeerSyncRuntime {
    /// `app_data_dir()/peersync`. TOML + sqlite + iroh-data all live here.
    pub base_dir: PathBuf,
    /// Cached config (reloaded from disk on save).
    pub config: Config,
    /// Handle to the spawned task that owns the engine. `Some` iff engine
    /// is running. Aborting the task drops the engine, which closes the
    /// iroh router and ends the run loop.
    pub task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Cached share ticket — populated on first `peersync_start` or after `peersync_link_device`.
    pub ticket: Option<String>,
    /// Shared broadcast sender for engine events. Cloned into each engine
    /// instance; a single forwarder task in `new_state` listens on the
    /// corresponding receiver and re-emits to the Tauri event bus.
    pub events_tx: tokio::sync::broadcast::Sender<peersync::events::EngineEvent>,
}

/// Wrapper for tauri: status + engine state in one payload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerSyncStatusPayload {
    pub engine_running: bool,
    pub ticket: Option<String>,
    pub status: StatusInfo,
}

/// Initialize the runtime state. Call once during app setup.
///
/// Returns the shared state plus a join handle for the long-lived
/// forwarder task that pumps engine events onto the Tauri event bus.
/// The forwarder runs for the lifetime of the app; you can ignore the
/// handle (or store it for diagnostics).
pub fn new_state(
    app: &tauri::AppHandle,
) -> Result<(PeerSyncState, tauri::async_runtime::JoinHandle<()>), String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?
        .join("peersync");
    std::fs::create_dir_all(&base).map_err(|e| format!("creating peersync dir: {}", e))?;

    let config = peersync::config::load_config(Some(&base)).unwrap_or_default();
    let (events_tx, events_rx) = peersync::events::channel();

    let runtime = Arc::new(RwLock::new(PeerSyncRuntime {
        base_dir: base,
        config,
        task: None,
        ticket: None,
        events_tx,
    }));

    // Spawn the forwarder. It receives on the broadcast channel and emits
    // each event as "peersync-event" on the Tauri bus. If the engine is
    // not running, the channel is silent — no work done.
    let app_handle = app.clone();
    let forwarder = tauri::async_runtime::spawn(async move {
        let mut rx = events_rx;
        loop {
            match rx.recv().await {
                Ok(event) => {
                    // StatusRefresh is a no-payload signal — emit it under a
                    // distinct event name so the frontend can listen for it
                    // without parsing the full event envelope.
                    let event_name = match &event {
                        peersync::events::EngineEvent::StatusRefresh => {
                            "peersync-status-refresh"
                        }
                        _ => "peersync-event",
                    };
                    if let Err(e) = app_handle.emit(event_name, &event) {
                        tracing::warn!(error = %e, "failed to forward peersync event");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(skipped = n, "peersync event subscriber lagged");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    Ok((runtime, forwarder))
}

// ----- Commands -----

#[tauri::command]
pub async fn peersync_get_config(
    state: tauri::State<'_, PeerSyncState>,
) -> Result<Config, String> {
    let guard = state.read().await;
    Ok(guard.config.clone())
}

#[tauri::command]
pub async fn peersync_save_config(
    state: tauri::State<'_, PeerSyncState>,
    config: Config,
) -> Result<(), String> {
    let mut guard = state.write().await;
    peersync::config::save_config(Some(&guard.base_dir), &config)
        .map_err(|e| e.to_string())?;
    guard.config = config;
    Ok(())
}

/// Add a single target to the config. Validates that `src` expands to an
/// existing directory, generates a unique label if the supplied one
/// collides, and persists the resulting config. Returns the updated config.
/// Add a single target to the config. Validates that `src` expands to an
/// existing directory, generates a unique label if the supplied one
/// collides, and persists the resulting config. Returns the updated config.
#[tauri::command]
pub async fn peersync_add_target(
    state: tauri::State<'_, PeerSyncState>,
    label: String,
    src: String,
) -> Result<Config, String> {
    let mut guard = state.write().await;

    // Validate the path is a real directory.
    let expanded = peersync::config::expand_path(&src)
        .map_err(|e| format!("expanding path: {}", e))?;
    let meta = std::fs::metadata(&expanded)
        .map_err(|e| format!("stat {}: {}", expanded.display(), e))?;
    if !meta.is_dir() {
        return Err(format!("not a directory: {}", expanded.display()));
    }

    // Pick a non-colliding label: try the user's label first, then "{label}-2",
    // "{label}-3", ... up to 1000 before giving up.
    let mut candidate = label.trim().to_string();
    if candidate.is_empty() {
        candidate = expanded
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("target")
            .to_string();
    }
    let mut final_label = candidate.clone();
    if guard.config.targets.contains_key(&final_label) {
        for n in 2..=1000 {
            final_label = format!("{candidate}-{n}");
            if !guard.config.targets.contains_key(&final_label) {
                break;
            }
            if n == 1000 {
                return Err(format!(
                    "could not find a free label based on '{}' after {} tries",
                    candidate, n
                ));
            }
        }
    }

    let mut next_targets = guard.config.targets.clone();
    next_targets.insert(
        final_label.clone(),
        peersync::config::TargetConfig {
            src: src.clone(),
            ignore: Vec::new(),
        },
    );
    let next_config = Config {
        device_name: guard.config.device_name.clone(),
        targets: next_targets,
    };

    peersync::config::save_config(Some(&guard.base_dir), &next_config)
        .map_err(|e| format!("saving config: {}", e))?;
    guard.config = next_config.clone();
    Ok(next_config)
}

#[tauri::command]
pub async fn peersync_start(state: tauri::State<'_, PeerSyncState>) -> Result<(), String> {
    let mut guard = state.write().await;
    if guard.task.is_some() {
        return Ok(()); // already running
    }

    let st = peersync::state::load_state(&guard.config, Some(&guard.base_dir))
        .map_err(|e| format!("loading state: {}", e))?;

    let engine = SyncEngine::start(
        guard.config.clone(),
        Some(guard.base_dir.clone()),
        Some(guard.base_dir.clone()),
        st,
        Some(guard.events_tx.clone()),
    )
    .await
    .map_err(|e| format!("starting engine: {}", e))?;

    guard.ticket = engine.ticket();

    // Engine is owned by the task. To stop, abort the task — the engine
    // drops, the iroh router closes, the run loop ends.
    let task = tauri::async_runtime::spawn(async move {
        if let Err(e) = engine.run().await {
            tracing::warn!(error = %e, "peersync engine exited with error");
        }
    });

    guard.task = Some(task);
    tracing::info!("peersync engine started");
    Ok(())
}

#[tauri::command]
pub async fn peersync_stop(state: tauri::State<'_, PeerSyncState>) -> Result<(), String> {
    let mut guard = state.write().await;
    if let Some(task) = guard.task.take() {
        task.abort();
        let _ = task.await; // wait for clean drop
    }
    tracing::info!("peersync engine stopped");
    Ok(())
}

#[tauri::command]
pub async fn peersync_get_ticket(
    state: tauri::State<'_, PeerSyncState>,
) -> Result<Option<String>, String> {
    let guard = state.read().await;
    Ok(guard.ticket.clone())
}

/// Import a doc ticket from another device. Stops any running engine, writes
/// the new namespace id + our local share ticket to state, and returns the
/// local ticket so the user can paste it on yet another device if they want.
/// Caller must restart the engine to begin syncing with the new namespace.
#[tauri::command]
pub async fn peersync_link_device(
    state: tauri::State<'_, PeerSyncState>,
    ticket: String,
) -> Result<String, String> {
    let mut guard = state.write().await;
    // Stop any running engine so it doesn't keep using the old namespace.
    if let Some(task) = guard.task.take() {
        task.abort();
        let _ = task.await;
    }

    let mut st = peersync::state::load_state(&guard.config, Some(&guard.base_dir))
        .map_err(|e| format!("loading state: {}", e))?;

    let network = peersync::network::Network::start(
        Some(&guard.base_dir),
        Some(&guard.base_dir),
        &st,
    )
    .await
    .map_err(|e| format!("starting network: {}", e))?;

    let ns = network
        .import_ticket(&ticket)
        .await
        .map_err(|e| format!("importing ticket: {}", e))?;

    let local_ticket = network
        .share_doc(ns)
        .await
        .map_err(|e| format!("sharing doc: {}", e))?;

    st.namespace_id = Some(ns.to_string());
    st.ticket = Some(local_ticket.clone());
    peersync::state::save_state(Some(&guard.base_dir), &st)
        .map_err(|e| format!("saving state: {}", e))?;

    guard.ticket = Some(local_ticket.clone());
    let _ = network.shutdown().await;

    Ok(local_ticket)
}

#[tauri::command]
pub async fn peersync_get_status(
    state: tauri::State<'_, PeerSyncState>,
) -> Result<PeerSyncStatusPayload, String> {
    let guard = state.read().await;

    let engine_running = guard.task.is_some();
    let ticket = guard.ticket.clone();

    let st = peersync::state::load_state(&guard.config, Some(&guard.base_dir))
        .map_err(|e| format!("loading state: {}", e))?;
    let history = History::open(Some(&guard.base_dir), Some(&guard.base_dir))
        .map_err(|e| format!("opening history: {}", e))?;

    // Pass None for the network — we don't expose live peer counts across the
    // tauri boundary (Network isn't Clone/Send-friendly to share). The DB
    // peer history still surfaces devices that have ever been seen.
    let status = peersync::status::collect_status(&guard.config, &st, &history, None)
        .await
        .map_err(|e| format!("collecting status: {}", e))?;

    Ok(PeerSyncStatusPayload {
        engine_running,
        ticket,
        status,
    })
}

#[tauri::command]
pub async fn peersync_get_history(
    state: tauri::State<'_, PeerSyncState>,
    limit: Option<usize>,
) -> Result<Vec<SyncRecord>, String> {
    let guard = state.read().await;
    let history = History::open(Some(&guard.base_dir), Some(&guard.base_dir))
        .map_err(|e| format!("opening history: {}", e))?;
    history
        .query(None, None, None, limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn peersync_run_gc(
    state: tauri::State<'_, PeerSyncState>,
    retention_days: u64,
    dry_run: bool,
) -> Result<GcReport, String> {
    let guard = state.read().await;
    let history = History::open(Some(&guard.base_dir), Some(&guard.base_dir))
        .map_err(|e| format!("opening history: {}", e))?;
    peersync::gc::run_gc(&guard.config, &history, retention_days, dry_run)
        .await
        .map_err(|e| e.to_string())
}

/// Resolve a conflict backup file.
///
/// - `delete_backup`: remove the `.peersync_conflict.{device}.{ts}` file
///   and accept the on-disk main file (which holds the remote content
///   that overwrote our local).
/// - `restore_from_backup`: read the backup, replace the main file with
///   its content, publish the new local content + mtime to the doc so
///   peers re-sync, then remove the backup file. Uses a transient
///   Network so the engine does not need to be running.
#[tauri::command]
pub async fn peersync_resolve_conflict(
    state: tauri::State<'_, PeerSyncState>,
    target_key: String,
    relative_path: String,
    action: String,
) -> Result<(), String> {
    let mut guard = state.write().await;
    let target = guard
        .config
        .targets
        .get(&target_key)
        .ok_or_else(|| format!("unknown target {}", target_key))?
        .clone();
    let base_dir = guard.base_dir.clone();
    let device_name = guard.config.device_name.clone();

    let src = peersync::config::expand_path(&target.src)
        .map_err(|e| format!("expanding target path: {}", e))?;
    let backup_path = src.join(&relative_path);

    let backup_name = backup_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "conflict path has no file name".to_string())?;
    let original_name = peersync::fs::strip_conflict_suffix(backup_name).ok_or_else(|| {
        format!(
            "path is not a conflict backup (missing .peersync_conflict.<device>.<ts> suffix): {}",
            backup_path.display()
        )
    })?;
    let original_relative = backup_path
        .parent()
        .and_then(|p| p.strip_prefix(&src).ok())
        .map(|p| p.join(&original_name).to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| original_name.clone());
    let original_path = backup_path.with_file_name(&original_name);

    match action.as_str() {
        "delete_backup" => {
            std::fs::remove_file(&backup_path)
                .map_err(|e| format!("deleting {}: {}", backup_path.display(), e))?;
            Ok(())
        }
        "restore_from_backup" => {
            // Engine must be stopped while we mutate the doc.
            guard.task = None;

            // Read backup bytes.
            let data = std::fs::read(&backup_path)
                .map_err(|e| format!("reading {}: {}", backup_path.display(), e))?;
            let size = data.len() as u64;

            // Open transient network + doc.
            let st = peersync::state::load_state(&guard.config, Some(&base_dir))
                .map_err(|e| format!("loading state: {}", e))?;
            let network = peersync::network::Network::start(
                Some(&base_dir),
                Some(&base_dir),
                &st,
            )
            .await
            .map_err(|e| format!("starting network: {}", e))?;

            let result: anyhow::Result<()> = async {
                let namespace = st
                    .namespace_id
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("no namespace in state"))?
                    .parse::<iroh_docs::NamespaceId>()
                    .context("parsing namespace id")?;
                let author = network.default_author().await.context("default author")?;
                let doc = network.open_doc(namespace).await.context("opening doc")?;

                // Import backup bytes into the blob store.
                let tag_info = network
                    .blobs
                    .add_bytes(bytes::Bytes::from(data.clone()))
                    .with_tag()
                    .await
                    .context("adding backup to blobs")?;
                let file_hash = format!("b3_{}", tag_info.hash.to_hex());

                let meta = peersync::metadata::FileMetadata {
                    relative_path: original_relative.clone(),
                    target_key: target_key.clone(),
                    file_hash,
                    size,
                    updated_at: peersync::fs::now_ms(),
                    last_modified_by: device_name,
                    is_deleted: false,
                };
                doc.set_bytes(author, meta.doc_key(), meta.to_bytes()?)
                    .await
                    .context("setting doc entry")?;

                // Atomically write backup content to the main path.
                peersync::fs::atomic_write(&original_path, &data)
                    .context("writing restored file")?;

                // Remove the backup.
                std::fs::remove_file(&backup_path)
                    .context("removing backup file")?;
                Ok(())
            }
            .await;

            let _ = network.shutdown().await;
            result.map_err(|e| format!("restore failed: {:#}", e))?;
            Ok(())
        }
        other => Err(format!("unknown action: {}", other)),
    }
}
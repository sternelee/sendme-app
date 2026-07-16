//! Engine event broadcast. The engine emits events as it processes sync
//! activity; Tauri (or any other frontend) subscribes via a
//! [`tokio::sync::broadcast`] channel and re-emits them on its own bus.

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::history::SyncRecord;

/// A single event from the sync engine.
///
/// Variants are intentionally coarse — the heavy state lives in the
/// SQLite history + status, so a frontend can just re-query when it
/// needs detail. These events tell it "something changed, go look".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    /// A new audit log record was written.
    Logged { record: SyncRecord },
    /// Engine has fully shut down (either by stop signal or fatal error).
    /// The frontend should refresh status and disable controls.
    Stopped,
    /// An error that didn't kill the engine but is worth surfacing.
    Warning { message: String },
    /// Something the UI should refresh status for just happened — emitted
    /// after relevant Logged events. The host should re-collect status
    /// (the engine doesn't ship the full payload because it would need a
    /// blocking DB read on every event).
    StatusRefresh,
}

/// Channel capacity. Slow consumers drop oldest events; we don't block the
/// engine on UI backpressure.
pub const CHANNEL_CAPACITY: usize = 256;

/// Construct a paired sender + receiver.
pub fn channel() -> (
    broadcast::Sender<EngineEvent>,
    broadcast::Receiver<EngineEvent>,
) {
    broadcast::channel(CHANNEL_CAPACITY)
}

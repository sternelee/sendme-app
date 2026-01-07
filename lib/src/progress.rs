//! Progress reporting abstractions for the sendme library.

use iroh_blobs::Hash;
use serde::{Deserialize, Serialize};

/// Unified progress event type sent through channels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProgressEvent {
    /// Import progress events with file name.
    Import(String, ImportProgress),
    /// Export progress events with file name.
    Export(String, ExportProgress),
    /// Download progress events.
    Download(DownloadProgress),
    /// Connection status events.
    Connection(ConnectionStatus),
}

/// Progress events for import operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ImportProgress {
    /// Import operation started.
    Started { total_files: usize },
    /// A file import started.
    FileStarted { name: String, size: u64 },
    /// File import progress update.
    FileProgress { name: String, offset: u64 },
    /// A file import completed.
    FileCompleted { name: String },
    /// Entire import completed.
    Completed { total_size: u64 },
}

/// Progress events for export operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExportProgress {
    /// Export operation started.
    Started { total_files: usize },
    /// A file export started.
    FileStarted { name: String, size: u64 },
    /// File export progress update.
    FileProgress { name: String, offset: u64 },
    /// A file export completed.
    FileCompleted { name: String },
    /// Entire export completed.
    Completed,
}

/// Progress events for download operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DownloadProgress {
    /// Connecting to the sender.
    Connecting,
    /// Getting sizes of blobs to download.
    GettingSizes,
    /// Metadata received - filenames and total size are now known.
    Metadata {
        /// Total size in bytes of all files in the collection.
        ///
        /// When downloading from a remote sender, this is calculated by summing
        /// the actual file sizes from the collection. When using locally cached
        /// data, this uses the cache's total size which may include metadata overhead.
        total_size: u64,
        /// Number of files in the collection
        file_count: u64,
        /// Names of files/directories in the collection
        names: Vec<String>,
    },
    /// Downloading data.
    Downloading { offset: u64, total: u64 },
    /// Download completed.
    Completed,
}

/// Connection status events for provider side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionStatus {
    /// A client connected.
    ClientConnected {
        endpoint_id: String,
        connection_id: u64,
    },
    /// A connection was closed.
    ConnectionClosed { connection_id: u64 },
    /// A transfer request started.
    RequestStarted {
        connection_id: u64,
        request_id: u64,
        hash: Hash,
        size: u64,
    },
    /// Transfer request progress update.
    RequestProgress {
        connection_id: u64,
        request_id: u64,
        offset: u64,
    },
    /// A transfer request completed.
    RequestCompleted {
        connection_id: u64,
        request_id: u64,
    },
}

/// Channel sender type for progress events.
pub type ProgressSenderTx = tokio::sync::mpsc::Sender<ProgressEvent>;

/// Channel receiver type for progress events.
pub type ProgressReceiverRx = tokio::sync::mpsc::Receiver<ProgressEvent>;

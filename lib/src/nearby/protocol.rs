//! Protocol messages for nearby transfer

use serde::{Deserialize, Serialize};

/// ALPN protocol identifier
pub const ALPN: &[u8] = b"sendme/transfer/v1";

/// Control messages sent over bi-stream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Message {
    /// Hello - exchange device identity
    Hello {
        device_name: String,
        device_type: String,
        endpoint_id: String,
    },
    /// Offer - sender sends file manifest
    Offer {
        files: Vec<FileInfo>,
        total_size: u64,
    },
    /// Accept - receiver accepts transfer
    Accept {
        session_id: String,
    },
    /// Decline - receiver declines
    Decline {
        session_id: String,
        reason: Option<String>,
    },
    /// BlobTicket - sender sends iroh blob ticket for data transfer
    BlobTicket {
        session_id: String,
        ticket: String,
    },
    /// Cancel - either side cancels
    Cancel {
        session_id: String,
        reason: Option<String>,
    },
}

/// File information in manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
}

/// Transfer manifest containing file list
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferManifest {
    pub files: Vec<FileInfo>,
    pub total_size: u64,
}

impl TransferManifest {
    pub fn new(files: Vec<FileInfo>) -> Self {
        let total_size = files.iter().map(|f| f.size).sum();
        Self { files, total_size }
    }
}
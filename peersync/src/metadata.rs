use serde::{Deserialize, Serialize};

/// Metadata stored in iroh-docs for each synced file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileMetadata {
    /// Relative path within the target.
    pub relative_path: String,
    /// Target label from the config.
    pub target_key: String,
    /// BLAKE3 hash of the file content (hex, with `b3_` prefix).
    pub file_hash: String,
    /// File size in bytes.
    #[serde(default)]
    pub size: u64,
    /// Last modification timestamp (milliseconds since UNIX epoch).
    pub updated_at: u64,
    /// Node id (public key) that last modified this file.
    pub last_modified_by: String,
    /// Tombstone marker.
    #[serde(default)]
    pub is_deleted: bool,
}

impl FileMetadata {
    /// Build a doc key from target and relative path.
    pub fn doc_key(&self) -> String {
        format!("/peersync/files/{}/{}", self.target_key, self.relative_path)
    }

    /// Serialize to JSON bytes.
    pub fn to_bytes(&self) -> anyhow::Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }

    /// Deserialize from JSON bytes.
    pub fn from_bytes(bytes: &[u8]) -> anyhow::Result<Self> {
        Ok(serde_json::from_slice(bytes)?)
    }
}

/// Parse a doc key into (target_key, relative_path).
pub fn parse_doc_key(key: &str) -> Option<(String, String)> {
    let prefix = "/peersync/files/";
    let rest = key.strip_prefix(prefix)?;
    let (target, rel) = rest.split_once('/')?;
    Some((target.to_string(), rel.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_doc_key_roundtrip() {
        let meta = FileMetadata {
            relative_path: "init.lua".to_string(),
            target_key: "nvim".to_string(),
            file_hash: "b3_abc".to_string(),
            size: 100,
            updated_at: 123,
            last_modified_by: "me".to_string(),
            is_deleted: false,
        };
        let key = meta.doc_key();
        assert_eq!(key, "/peersync/files/nvim/init.lua");
        let parsed = parse_doc_key(&key).unwrap();
        assert_eq!(parsed.0, "nvim");
        assert_eq!(parsed.1, "init.lua");
    }
}

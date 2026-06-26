use anyhow::{Context, Result};
use blake3::Hasher;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Compute the BLAKE3 hash of a file's contents.
pub fn compute_file_hash(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)
        .with_context(|| format!("opening file for hashing {}", path.display()))?;
    let mut hasher = Hasher::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf).context("reading file for hash")?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("b3_{}", hasher.finalize().to_hex()))
}

/// Compute hash from bytes.
pub fn compute_hash_bytes(bytes: &[u8]) -> String {
    format!("b3_{}", blake3::hash(bytes).to_hex())
}

/// Convert a BLAKE3 hex string (with `b3_` prefix) to an `iroh_blobs::Hash`.
pub fn parse_hash(hash: &str) -> Result<iroh_blobs::Hash> {
    let hex = hash.strip_prefix("b3_").unwrap_or(hash);
    let bytes = hex::decode(hex).context("decoding hash hex")?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("hash must be 32 bytes"))?;
    Ok(iroh_blobs::Hash::from_bytes(bytes))
}

/// Get the last modification time of a file as milliseconds since UNIX epoch.
pub fn file_mtime_ms(path: &Path) -> Result<u64> {
    let meta =
        fs::metadata(path).with_context(|| format!("getting metadata {}", path.display()))?;
    let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let duration = mtime.duration_since(UNIX_EPOCH).unwrap_or_default();
    Ok(duration.as_millis() as u64)
}

/// Current timestamp in milliseconds.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Read an entire file into memory.
pub fn read_file(path: &Path) -> Result<Vec<u8>> {
    fs::read(path).with_context(|| format!("reading file {}", path.display()))
}

/// Atomically write data to a file.
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating parent dir {}", parent.display()))?;
    }
    let tmp = path.with_extension("peersync_tmp");
    {
        let mut file = fs::File::create(&tmp)
            .with_context(|| format!("creating temp file {}", tmp.display()))?;
        file.write_all(data)
            .with_context(|| format!("writing temp file {}", tmp.display()))?;
        file.sync_all().context("syncing temp file")?;
    }
    fs::rename(&tmp, path)
        .with_context(|| format!("renaming {} to {}", tmp.display(), path.display()))?;
    Ok(())
}

/// Backup an existing file before overwriting.
/// Returns the backup path if a backup was created.
pub fn backup_existing_file(path: &Path, device_name: &str) -> Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let timestamp = now_ms();
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let backup_name = format!(
        "{}.peersync_conflict.{}.{}",
        file_name, device_name, timestamp
    );
    let backup_path = path.with_file_name(backup_name);
    fs::copy(path, &backup_path)
        .with_context(|| format!("backing up {} to {}", path.display(), backup_path.display()))?;
    Ok(Some(backup_path))
}

/// Inverse of the naming convention in `backup_existing_file`. Given a
/// filename like `init.lua.peersync_conflict.macbook.1700000000000`,
/// returns `init.lua`. Returns `None` if the name doesn't follow the
/// conflict backup convention (so callers can refuse to operate on
/// arbitrary paths).
pub fn strip_conflict_suffix(name: &str) -> Option<String> {
    const MARKER: &str = ".peersync_conflict.";
    let idx = name.find(MARKER)?;
    let after = &name[idx + MARKER.len()..];
    // Trailing segment must be all digits (the millisecond timestamp).
    let dot = after.rfind('.')?;
    let ts = &after[dot + 1..];
    if ts.is_empty() || !ts.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(name[..idx].to_string())
}

/// Check whether a path should be ignored based on glob-like patterns.
///
/// `relative` is the path relative to the target root (forward-slash
/// separators). `patterns` is a slice of glob strings; supported syntax
/// matches the `globset` crate (e.g. `*.swp`, `.git/**`, `**/node_modules`).
///
/// `target_label` is only used to format error messages.
pub fn build_ignore_set(target_label: &str, patterns: &[String]) -> Result<IgnoreSet> {
    let mut builder = globset::GlobSetBuilder::new();
    for pat in patterns {
        let glob = globset::Glob::new(pat).with_context(|| {
            format!(
                "invalid ignore pattern '{}' in target '{}'",
                pat, target_label
            )
        })?;
        builder.add(glob);
    }
    Ok(IgnoreSet {
        set: builder.build().context("building ignore set")?,
    })
}

/// Pre-compiled ignore-pattern matcher. Build once per target at engine
/// start; use [`Self::matches`] on each path. Compiling a globset is
/// relatively expensive, so don't rebuild on every fs event.
#[derive(Debug, Clone)]
pub struct IgnoreSet {
    set: globset::GlobSet,
}

impl IgnoreSet {
    /// True if `relative` (forward-slash path under a target root) matches
    /// any of the configured ignore patterns.
    pub fn matches(&self, relative: &str) -> bool {
        self.set.is_match(relative)
    }

    /// Always-empty matcher. Useful as a default when a target has no
    /// ignore patterns, so callers can use a single code path.
    pub fn empty() -> Self {
        Self {
            set: globset::GlobSetBuilder::new()
                .build()
                .expect("empty globset builds"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_parse() {
        let data = b"hello world";
        let hash = compute_hash_bytes(data);
        assert!(hash.starts_with("b3_"));
        let parsed = parse_hash(&hash).unwrap();
        assert_eq!(
            parsed.to_hex().to_string(),
            hash.strip_prefix("b3_").unwrap()
        );
    }

    #[test]
    fn test_atomic_write_and_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.txt");
        atomic_write(&path, b"v1").unwrap();
        let backup = backup_existing_file(&path, "dev1").unwrap();
        assert!(backup.is_some());
        atomic_write(&path, b"v2").unwrap();
        assert_eq!(read_file(&path).unwrap(), b"v2");
        assert_eq!(read_file(&backup.unwrap()).unwrap(), b"v1");
    }

    #[test]
    fn test_ignore_set_glob_patterns() {
        let set = build_ignore_set(
            "t",
            &[
                ".git/**".to_string(),
                "*.swp".to_string(),
                "node_modules/**".to_string(),
            ],
        )
        .unwrap();
        assert!(set.matches("foo.swp"));
        assert!(set.matches("subdir/foo.swp"));
        assert!(set.matches(".git/HEAD"));
        assert!(set.matches(".git/objects/abc"));
        assert!(set.matches("node_modules/foo/bar.js"));
        assert!(!set.matches("src/main.rs"));
        assert!(!set.matches("readme.md"));
    }

    #[test]
    fn test_ignore_set_invalid_pattern_errors() {
        let err = build_ignore_set("t", &["[unclosed".to_string()]).unwrap_err();
        assert!(err.to_string().contains("invalid ignore pattern"));
    }

    #[test]
    fn test_ignore_set_empty() {
        let set = IgnoreSet::empty();
        assert!(!set.matches("anything"));
    }

    #[test]
    fn test_strip_conflict_suffix() {
        assert_eq!(
            strip_conflict_suffix("init.lua.peersync_conflict.macbook.1700000000000"),
            Some("init.lua".to_string())
        );
        assert_eq!(
            strip_conflict_suffix("a/b/c.txt.peersync_conflict.dev.laptop.42"),
            Some("a/b/c.txt".to_string())
        );
        // Not a conflict backup:
        assert_eq!(strip_conflict_suffix("init.lua"), None);
        assert_eq!(strip_conflict_suffix("a.txt.peersync_conflict"), None);
        assert_eq!(
            strip_conflict_suffix("a.txt.peersync_conflict.device.notanumber"),
            None
        );
    }
}

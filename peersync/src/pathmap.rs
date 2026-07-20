//! Cross-machine path mapping.
//!
//! Different devices have different home directories, OS conventions, and
//! installed binary paths. Config files often contain hardcoded absolute
//! paths (e.g. MCP server commands, plugin paths). This module handles
//! transparent substitution:
//!
//! - **Upload**: replace local path values with `${VAR_NAME}` placeholders.
//! - **Download**: replace `${VAR_NAME}` placeholders with local path values.
//!
//! Additionally, per-target `overrides` allow the same sync target to map
//! to different local directories on different devices (e.g. Claude config
//! lives in `~/Library/Application Support/Claude` on macOS but
//! `~/.config/Claude` on Linux).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Placeholder prefix/suffix for path variables in file content.
/// Uses `${VAR_NAME}` syntax — unlikely to appear in real config files
/// unless the user intentionally uses shell-style variables.
const VAR_PREFIX: &str = "${";
const VAR_SUFFIX: &str = "}";

/// Maximum file size for content-level path substitution (1 MB).
/// Larger files are synced as-is to avoid excessive memory usage.
const MAX_SUBSTITUTE_BYTES: u64 = 1024 * 1024;

/// Extensions considered "text" for path substitution purposes.
/// Files without a recognized extension are checked for null bytes.
const TEXT_EXTENSIONS: &[&str] = &[
    "lua", "vim", "toml", "yaml", "yml", "json", "jsonc", "json5", "xml", "ini", "cfg", "conf",
    "config", "rc", "sh", "bash", "zsh", "fish", "py", "rb", "js", "ts", "mjs", "cjs", "md",
    "txt", "rst", "org", "el", "clj", "edn", "scm", "rkt", "hs", "rs", "go", "c", "h", "cpp",
    "hpp", "java", "kt", "swift", "pl", "pm", "r", "R", "sql", "graphql", "proto", "css", "scss",
    "less", "html", "htm", "svg", "env", "gitignore", "gitconfig", "editorconfig",
];

/// Path variable configuration.
///
/// Keys are variable names (e.g. `HOME`, `BREW_PREFIX`).
/// Values are the **local** path they map to on this device.
///
/// ```toml
/// [path_vars]
/// HOME = "~"
/// XDG_CONFIG = "~/.config"
/// BREW_PREFIX = "/opt/homebrew"
/// ```
///
/// On upload, the local path value is replaced with `${HOME}` etc.
/// On download, `${HOME}` is replaced with the local path value.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PathVars(pub HashMap<String, String>);

impl PathVars {
    /// Build the substitution pairs sorted by path length descending.
    /// Longer paths are replaced first to avoid partial matches
    /// (e.g. `/Users/sternelee/.config` before `/Users/sternelee`).
    fn upload_pairs(&self) -> Vec<(String, String)> {
        let mut pairs: Vec<(String, String)> = self
            .0
            .iter()
            .map(|(name, value)| {
                let expanded = crate::config::expand_path(value)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| value.clone());
                (expanded, format!("{}{}{}", VAR_PREFIX, name, VAR_SUFFIX))
            })
            .collect();
        // Sort by path length descending so longer paths match first.
        pairs.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        pairs
    }

    fn download_pairs(&self) -> Vec<(String, String)> {
        let mut pairs: Vec<(String, String)> = self
            .0
            .iter()
            .map(|(name, value)| {
                let expanded = crate::config::expand_path(value)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| value.clone());
                (format!("{}{}{}", VAR_PREFIX, name, VAR_SUFFIX), expanded)
            })
            .collect();
        // Sort by placeholder length descending (less critical but consistent).
        pairs.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        pairs
    }
}

/// A compiled path mapper ready for use during sync.
pub struct PathMapper {
    upload_pairs: Vec<(String, String)>,
    download_pairs: Vec<(String, String)>,
}

impl PathMapper {
    /// Build a path mapper from configuration.
    /// Returns `None` if no path variables are configured (no-op).
    pub fn new(vars: &PathVars) -> Option<Self> {
        if vars.0.is_empty() {
            return None;
        }
        Some(Self {
            upload_pairs: vars.upload_pairs(),
            download_pairs: vars.download_pairs(),
        })
    }

    /// Create a no-op mapper (for testing or when path mapping is disabled).
    pub fn noop() -> Self {
        Self {
            upload_pairs: Vec::new(),
            download_pairs: Vec::new(),
        }
    }

    /// True if this mapper has any substitution rules.
    pub fn is_active(&self) -> bool {
        !self.upload_pairs.is_empty()
    }

    /// Check whether a file is eligible for content-level path substitution.
    ///
    /// Returns `false` for:
    /// - Binary files (detected by null bytes in first 8KB)
    /// - Files larger than [`MAX_SUBSTITUTE_BYTES`]
    /// - Files with non-text extensions
    pub fn is_text_file(path: &Path) -> bool {
        // Check size first (cheap).
        if let Ok(meta) = std::fs::metadata(path) {
            if meta.len() > MAX_SUBSTITUTE_BYTES {
                return false;
            }
        }

        // Check extension.
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if TEXT_EXTENSIONS.contains(&ext_lower.as_str()) {
                return true;
            }
            // Known binary extensions — skip immediately.
            if matches!(
                ext_lower.as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "bmp" | "ico" | "webp"
                | "zip" | "tar" | "gz" | "bz2" | "xz" | "7z"
                | "pdf" | "doc" | "docx" | "xls" | "xlsx"
                | "so" | "dylib" | "dll" | "exe" | "bin"
                | "woff" | "woff2" | "ttf" | "otf" | "eot"
                | "mp3" | "mp4" | "avi" | "mov" | "wav" | "flac"
                | "sqlite" | "db" | "pack" | "idx"
            ) {
                return false;
            }
        }

        // No recognized extension — check for null bytes (binary detection).
        // Read first 8KB and look for null bytes.
        match std::fs::read(path) {
            Ok(bytes) => {
                let check_len = bytes.len().min(8192);
                !bytes[..check_len].contains(&0)
            }
            Err(_) => false,
        }
    }

    /// Apply upload-time substitution: replace local paths with `${VAR}` placeholders.
    ///
    /// Returns the modified content, or `None` if no substitution was needed
    /// (content unchanged).
    pub fn substitute_for_upload(&self, content: &[u8]) -> Option<Vec<u8>> {
        if self.upload_pairs.is_empty() {
            return None;
        }
        let text = std::str::from_utf8(content).ok()?;
        let mut result = text.to_string();
        let mut changed = false;
        for (local_path, placeholder) in &self.upload_pairs {
            if result.contains(local_path.as_str()) {
                result = result.replace(local_path.as_str(), placeholder.as_str());
                changed = true;
            }
        }
        if changed {
            Some(result.into_bytes())
        } else {
            None
        }
    }

    /// Apply download-time substitution: replace `${VAR}` placeholders with local paths.
    ///
    /// Returns the modified content, or `None` if no substitution was needed.
    pub fn substitute_for_download(&self, content: &[u8]) -> Option<Vec<u8>> {
        if self.download_pairs.is_empty() {
            return None;
        }
        let text = std::str::from_utf8(content).ok()?;
        let mut result = text.to_string();
        let mut changed = false;
        for (placeholder, local_path) in &self.download_pairs {
            if result.contains(placeholder.as_str()) {
                result = result.replace(placeholder.as_str(), local_path.as_str());
                changed = true;
            }
        }
        if changed {
            Some(result.into_bytes())
        } else {
            None
        }
    }

    /// Convenience: read a file, apply upload substitution, return modified bytes.
    /// Returns `None` if the file is not a text file or no substitution occurred.
    pub fn read_and_substitute_for_upload(&self, path: &Path) -> Option<Vec<u8>> {
        if !Self::is_text_file(path) {
            return None;
        }
        let content = std::fs::read(path).ok()?;
        self.substitute_for_upload(&content)
    }
}

/// Resolve the effective source path for a target on this device.
///
/// Checks per-device overrides first, then falls back to the default `src`.
///
/// ```toml
/// [sync_targets.claude]
/// src = "~/.config/claude"
///
/// [sync_targets.claude.overrides]
/// "macbook" = "~/Library/Application Support/Claude"
/// "work-linux" = "~/.config/claude"
/// ```
pub fn resolve_target_src(
    target: &crate::config::TargetConfig,
    device_name: &str,
) -> String {
    if let Some(overrides) = &target.overrides {
        if let Some(override_path) = overrides.get(device_name) {
            return override_path.clone();
        }
    }
    target.src.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_vars() -> PathVars {
        let mut map = HashMap::new();
        map.insert("HOME".to_string(), "/Users/testuser".to_string());
        map.insert(
            "XDG_CONFIG".to_string(),
            "/Users/testuser/.config".to_string(),
        );
        map.insert("BREW".to_string(), "/opt/homebrew".to_string());
        PathVars(map)
    }

    #[test]
    fn test_upload_substitution() {
        let mapper = PathMapper::new(&test_vars()).unwrap();
        let content = br#"command = "/Users/testuser/.local/bin/uvx"
config = "/Users/testuser/.config/nvim"
brew = "/opt/homebrew/bin/node""#;

        let result = mapper.substitute_for_upload(content).unwrap();
        let text = String::from_utf8(result).unwrap();
        assert!(text.contains("${XDG_CONFIG}/nvim"), "got: {}", text);
        assert!(text.contains("${HOME}/.local/bin/uvx"), "got: {}", text);
        assert!(text.contains("${BREW}/bin/node"), "got: {}", text);
        assert!(!text.contains("/Users/testuser"), "got: {}", text);
    }

    #[test]
    fn test_download_substitution() {
        let mapper = PathMapper::new(&test_vars()).unwrap();
        let content = br#"command = "${HOME}/.local/bin/uvx"
config = "${XDG_CONFIG}/nvim"
brew = "${BREW}/bin/node""#;

        let result = mapper.substitute_for_download(content).unwrap();
        let text = String::from_utf8(result).unwrap();
        assert!(text.contains("/Users/testuser/.local/bin/uvx"), "got: {}", text);
        assert!(text.contains("/Users/testuser/.config/nvim"), "got: {}", text);
        assert!(text.contains("/opt/homebrew/bin/node"), "got: {}", text);
        assert!(!text.contains("${"), "got: {}", text);
    }

    #[test]
    fn test_no_substitution_needed() {
        let mapper = PathMapper::new(&test_vars()).unwrap();
        let content = b"vim.opt.number = true\nvim.opt.tabstop = 2\n";
        assert!(mapper.substitute_for_upload(content).is_none());
    }

    #[test]
    fn test_empty_vars_noop() {
        let mapper = PathMapper::new(&PathVars(HashMap::new()));
        assert!(mapper.is_none());
    }

    #[test]
    fn test_longer_path_replaced_first() {
        // Ensure XDG_CONFIG (/Users/testuser/.config) is replaced before
        // HOME (/Users/testuser), so we get ${XDG_CONFIG}/nvim not
        // ${HOME}/.config/nvim.
        let mapper = PathMapper::new(&test_vars()).unwrap();
        let content = b"path = /Users/testuser/.config/nvim";
        let result = mapper.substitute_for_upload(content).unwrap();
        let text = String::from_utf8(result).unwrap();
        assert_eq!(text, "path = ${XDG_CONFIG}/nvim");
    }

    #[test]
    fn test_is_text_file_by_extension() {
        assert!(PathMapper::is_text_file(Path::new("init.lua")));
        assert!(PathMapper::is_text_file(Path::new("config.toml")));
        assert!(PathMapper::is_text_file(Path::new("settings.json")));
        assert!(PathMapper::is_text_file(Path::new("README.md")));
        assert!(!PathMapper::is_text_file(Path::new("image.png")));
        assert!(!PathMapper::is_text_file(Path::new("archive.zip")));
        assert!(!PathMapper::is_text_file(Path::new("plugin.so")));
    }

    #[test]
    fn test_binary_detection_by_null_bytes() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), &[0x00, 0x01, 0x02, 0xFF]).unwrap();
        assert!(!PathMapper::is_text_file(tmp.path()));

        let tmp2 = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp2.path(), b"just plain text content").unwrap();
        // No extension → falls through to null byte check → text
        assert!(PathMapper::is_text_file(tmp2.path()));
    }

    #[test]
    fn test_resolve_target_src_with_override() {
        let mut overrides = HashMap::new();
        overrides.insert("macbook".to_string(), "~/Library/App/Claude".to_string());

        let target = crate::config::TargetConfig {
            src: "~/.config/claude".to_string(),
            ignore: vec![],
            overrides: Some(overrides),
        };

        // Matching device → use override
        assert_eq!(
            resolve_target_src(&target, "macbook"),
            "~/Library/App/Claude"
        );
        // Non-matching device → use default src
        assert_eq!(
            resolve_target_src(&target, "linux-box"),
            "~/.config/claude"
        );
    }

    #[test]
    fn test_resolve_target_src_no_override() {
        let target = crate::config::TargetConfig {
            src: "~/.config/nvim".to_string(),
            ignore: vec![],
            overrides: None,
        };
        assert_eq!(resolve_target_src(&target, "any-device"), "~/.config/nvim");
    }
}

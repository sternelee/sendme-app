//! Secret detection and filtering for synced files.
//!
//! Prevents accidental sync of credentials, API keys, tokens, and other
//! sensitive content across devices. Operates at two levels:
//!
//! 1. **File-level**: skip entire files matching glob patterns (e.g. `.env`).
//! 2. **Content-level**: scan file content for regex patterns matching known
//!    secret formats (e.g. `sk-...`, `ghp_...`).
//!
//! When a secret is detected the file is skipped (not synced) and a warning
//! is emitted. The original file on disk is never modified.

use anyhow::{Context, Result};
use globset::GlobSet;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Maximum bytes to scan for content-level secrets. Files larger than this
/// are only subject to file-level filtering. 256 KB covers virtually all
/// human-editable config files while bounding scan cost.
const MAX_SCAN_BYTES: usize = 256 * 1024;

/// Security configuration — part of the top-level [`Config`](crate::config::Config).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityConfig {
    /// Glob patterns for files to skip entirely (matched against the
    /// relative path within a target). Examples: `**/.env`, `**/id_rsa`.
    #[serde(default = "default_skip_files")]
    pub skip_files: Vec<String>,

    /// Regex patterns scanned against file content. If any pattern matches,
    /// the file is skipped. Patterns use the `regex` crate syntax.
    #[serde(default = "default_content_patterns")]
    pub content_patterns: Vec<String>,

    /// What to do when a secret is detected.
    #[serde(default)]
    pub action: SecretAction,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            skip_files: default_skip_files(),
            content_patterns: default_content_patterns(),
            action: SecretAction::default(),
        }
    }
}

/// Action taken when a secret is detected in a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SecretAction {
    /// Skip the file entirely — do not sync it (default, safest).
    #[default]
    Skip,
    /// Sync the file but emit a warning. Use only if you understand the risk.
    Warn,
}

fn default_skip_files() -> Vec<String> {
    vec![
        // Environment files
        "**/.env".to_string(),
        "**/.env.*".to_string(),
        // SSH keys (never sync private keys)
        "**/id_rsa".to_string(),
        "**/id_ed25519".to_string(),
        "**/id_ecdsa".to_string(),
        "**/id_dsa".to_string(),
        "**/*.pem".to_string(),
        "**/*.key".to_string(),
        // Credential stores
        "**/credentials".to_string(),
        "**/credentials.json".to_string(),
        "**/credentials.toml".to_string(),
        "**/secrets.*".to_string(),
        "**/.netrc".to_string(),
        "**/.npmrc".to_string(),
        "**/.pypirc".to_string(),
        // Cloud CLI configs with embedded tokens
        "**/.aws/credentials".to_string(),
        "**/.docker/config.json".to_string(),
        "**/.gnupg/**".to_string(),
        // Keychain / wallet files
        "**/*.keychain".to_string(),
        "**/*.keystore".to_string(),
        "**/keyring/**".to_string(),
        // Peersync's own state (contains the iroh secret key!)
        "**/peersync/state.toml".to_string(),
    ]
}

fn default_content_patterns() -> Vec<String> {
    vec![
        // OpenAI / Anthropic API keys
        r"sk-[a-zA-Z0-9]{20,}".to_string(),
        r"sk-ant-[a-zA-Z0-9_-]{20,}".to_string(),
        // GitHub tokens (PAT, fine-grained, OAuth)
        r"ghp_[a-zA-Z0-9]{36}".to_string(),
        r"github_pat_[a-zA-Z0-9_]{22,}".to_string(),
        r"gho_[a-zA-Z0-9]{36}".to_string(),
        // Slack tokens
        r"xox[bpsa]-[a-zA-Z0-9\-]{10,}".to_string(),
        // Google API keys
        r"AIza[0-9A-Za-z_-]{35}".to_string(),
        // AWS access key IDs
        r"AKIA[0-9A-Z]{16}".to_string(),
        // Generic JWT (very broad — only in JSON-like context)
        r#""(?:api_key|apikey|secret_key|access_token|auth_token|private_key)"\s*:\s*"[^"]{16,}""#
            .to_string(),
        // Bearer tokens in config files
        r#"(?:^|\s)(?:token|password|passwd|secret)\s*=\s*["'][^"']{16,}["']"#.to_string(),
        // Private key blocks
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----".to_string(),
    ]
}

/// Compiled security filter. Build once at engine start, use on every upload.
pub struct SecurityFilter {
    skip_globs: GlobSet,
    content_regexes: Vec<(String, Regex)>,
    action: SecretAction,
}

impl SecurityFilter {
    /// Compile the security configuration into a ready-to-use filter.
    pub fn new(config: &SecurityConfig) -> Result<Self> {
        let mut glob_builder = globset::GlobSetBuilder::new();
        for pattern in &config.skip_files {
            let glob = globset::Glob::new(pattern)
                .with_context(|| format!("invalid skip_files pattern: {}", pattern))?;
            glob_builder.add(glob);
        }
        let skip_globs = glob_builder.build().context("building skip_files globset")?;

        let mut content_regexes = Vec::new();
        for pattern in &config.content_patterns {
            let re = Regex::new(pattern)
                .with_context(|| format!("invalid content_pattern regex: {}", pattern))?;
            content_regexes.push((pattern.clone(), re));
        }

        Ok(Self {
            skip_globs,
            content_regexes,
            action: config.action,
        })
    }

    /// Create a permissive filter that allows everything (for testing or
    /// when security is explicitly disabled).
    pub fn permissive() -> Self {
        Self {
            skip_globs: globset::GlobSetBuilder::new()
                .build()
                .expect("empty globset"),
            content_regexes: Vec::new(),
            action: SecretAction::Warn,
        }
    }

    /// Check whether a file should be skipped based on its relative path.
    /// Returns `Some(reason)` if the file should be skipped.
    pub fn check_path(&self, relative_path: &str) -> Option<String> {
        if self.skip_globs.is_match(relative_path) {
            Some("matches skip_files pattern (security policy)".to_string())
        } else {
            None
        }
    }

    /// Scan file content for secret patterns.
    /// Returns a list of matched pattern descriptions if secrets are found.
    ///
    /// Only scans the first [`MAX_SCAN_BYTES`] of the file. Binary files
    /// (containing null bytes in the first 8KB) are not scanned.
    pub fn scan_content(&self, path: &Path) -> Vec<String> {
        if self.content_regexes.is_empty() {
            return Vec::new();
        }

        let content = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(_) => return Vec::new(), // Can't read → let the upload handle the error
        };

        // Skip binary files (null byte in first 8KB).
        let check_len = content.len().min(8192);
        if content[..check_len].contains(&0) {
            return Vec::new();
        }

        // Only scan up to MAX_SCAN_BYTES.
        let scan_bytes = &content[..content.len().min(MAX_SCAN_BYTES)];
        let text = match std::str::from_utf8(scan_bytes) {
            Ok(t) => t,
            Err(_) => return Vec::new(), // Not valid UTF-8 → skip content scan
        };

        let mut matches = Vec::new();
        for (pattern, re) in &self.content_regexes {
            if re.is_match(text) {
                matches.push(format!("content matches secret pattern: {}", pattern));
            }
        }
        matches
    }

    /// Full security check for a file: path-level + content-level.
    /// Returns `Some(reason)` if the file should NOT be synced.
    pub fn check_file(&self, relative_path: &str, absolute_path: &Path) -> Option<String> {
        // 1. Path-level check.
        if let Some(reason) = self.check_path(relative_path) {
            return Some(reason);
        }

        // 2. Content-level check.
        let content_matches = self.scan_content(absolute_path);
        if !content_matches.is_empty() {
            match self.action {
                SecretAction::Skip => {
                    return Some(content_matches.join("; "));
                }
                SecretAction::Warn => {
                    tracing::warn!(
                        path = %relative_path,
                        matches = ?content_matches,
                        "secret pattern detected but action=warn, syncing anyway"
                    );
                    return None;
                }
            }
        }

        None
    }

    /// The configured action when secrets are detected.
    pub fn action(&self) -> SecretAction {
        self.action
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_filter() -> SecurityFilter {
        SecurityFilter::new(&SecurityConfig::default()).unwrap()
    }

    #[test]
    fn test_skip_env_files() {
        let f = default_filter();
        assert!(f.check_path(".env").is_some());
        assert!(f.check_path("config/.env").is_some());
        assert!(f.check_path("config/.env.local").is_some());
        assert!(f.check_path(".env.production").is_some());
        assert!(f.check_path("src/main.rs").is_none());
    }

    #[test]
    fn test_skip_ssh_keys() {
        let f = default_filter();
        assert!(f.check_path(".ssh/id_rsa").is_some());
        assert!(f.check_path(".ssh/id_ed25519").is_some());
        assert!(f.check_path("certs/server.pem").is_some());
        assert!(f.check_path("keys/private.key").is_some());
    }

    #[test]
    fn test_skip_credential_stores() {
        let f = default_filter();
        assert!(f.check_path(".aws/credentials").is_some());
        assert!(f.check_path(".docker/config.json").is_some());
        assert!(f.check_path(".gnupg/secring.gpg").is_some());
        assert!(f.check_path(".npmrc").is_some());
    }

    #[test]
    fn test_content_scan_openai_key() {
        let f = default_filter();
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(
            tmp.path(),
            r#"{"api_key": "sk-abc123def456ghi789jkl012mno345pqr678"}"#,
        )
        .unwrap();
        let matches = f.scan_content(tmp.path());
        assert!(!matches.is_empty(), "should detect OpenAI-style key");
    }

    #[test]
    fn test_content_scan_github_pat() {
        let f = default_filter();
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(
            tmp.path(),
            "token = \"ghp_abcdefghijklmnopqrstuvwxyz0123456789\"",
        )
        .unwrap();
        let matches = f.scan_content(tmp.path());
        assert!(!matches.is_empty(), "should detect GitHub PAT");
    }

    #[test]
    fn test_content_scan_private_key_block() {
        let f = default_filter();
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(
            tmp.path(),
            "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----",
        )
        .unwrap();
        let matches = f.scan_content(tmp.path());
        assert!(!matches.is_empty(), "should detect private key block");
    }

    #[test]
    fn test_content_scan_clean_file() {
        let f = default_filter();
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(
            tmp.path(),
            "vim.opt.number = true\nvim.opt.tabstop = 2\n",
        )
        .unwrap();
        let matches = f.scan_content(tmp.path());
        assert!(matches.is_empty(), "clean config file should pass");
    }

    #[test]
    fn test_content_scan_binary_file_skipped() {
        let f = default_filter();
        let tmp = tempfile::NamedTempFile::new().unwrap();
        // Binary content with null bytes.
        std::fs::write(tmp.path(), &[0x00, 0x01, 0x02, 0xFF, 0xFE]).unwrap();
        let matches = f.scan_content(tmp.path());
        assert!(matches.is_empty(), "binary files should not be scanned");
    }

    #[test]
    fn test_check_file_full() {
        let f = default_filter();
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), "sk-ant-abcdefghij1234567890xyz").unwrap();
        let result = f.check_file("config/settings.json", tmp.path());
        assert!(result.is_some(), "file with secret content should be blocked");
    }

    #[test]
    fn test_warn_action_allows_sync() {
        let config = SecurityConfig {
            action: SecretAction::Warn,
            ..Default::default()
        };
        let f = SecurityFilter::new(&config).unwrap();
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), "sk-ant-abcdefghij1234567890xyz").unwrap();
        // Path check passes, content matches but action=warn → returns None
        let result = f.check_file("config/settings.json", tmp.path());
        assert!(result.is_none(), "warn action should allow sync");
    }

    #[test]
    fn test_permissive_filter() {
        let f = SecurityFilter::permissive();
        assert!(f.check_path(".env").is_none());
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), "sk-ant-abcdefghij1234567890xyz").unwrap();
        assert!(f.check_file(".env", tmp.path()).is_none());
    }
}

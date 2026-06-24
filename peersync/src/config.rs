use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Per-target sync configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetConfig {
    /// Source path on the local filesystem. May contain `~`.
    pub src: String,
    /// Glob patterns to ignore.
    #[serde(default)]
    pub ignore: Vec<String>,
}

/// Top-level user configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Human-readable device name.
    #[serde(default = "default_device_name")]
    pub device_name: String,

    /// Map of target label -> target configuration.
    #[serde(rename = "sync_targets", default)]
    pub targets: HashMap<String, TargetConfig>,
}

fn default_device_name() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "peersync-device".to_string())
}

impl Default for Config {
    fn default() -> Self {
        Self {
            device_name: default_device_name(),
            targets: default_targets(),
        }
    }
}

fn default_targets() -> HashMap<String, TargetConfig> {
    let mut map = HashMap::new();
    map.insert(
        "nvim".to_string(),
        TargetConfig {
            src: "~/.config/nvim".to_string(),
            ignore: vec![".git/".to_string(), "undo/".to_string()],
        },
    );
    map.insert(
        "claude_code".to_string(),
        TargetConfig {
            src: "~/.config/claude-code".to_string(),
            ignore: vec![],
        },
    );
    map
}

/// Return the project directories for peersync.
pub fn project_dirs() -> Result<ProjectDirs> {
    ProjectDirs::from("dev", "sendme", "peersync")
        .context("could not determine project directories")
}

/// Configuration file path: `~/.config/peersync/config.toml`.
pub fn config_path(config_dir: Option<&Path>) -> Result<PathBuf> {
    match config_dir {
        Some(dir) => Ok(dir.join("config.toml")),
        None => {
            let dirs = project_dirs()?;
            Ok(dirs.config_dir().to_path_buf().join("config.toml"))
        }
    }
}

/// Expand `~` and environment variables in a path string.
pub fn expand_path(path: &str) -> Result<PathBuf> {
    let expanded = if path.starts_with("~/") || path == "~" {
        dirs::home_dir()
            .context("could not determine home directory")?
            .join(&path[2..])
    } else {
        PathBuf::from(path)
    };
    Ok(expanded)
}

/// Load the configuration, creating defaults if missing.
pub fn load_config(config_dir: Option<&Path>) -> Result<Config> {
    let path = config_path(config_dir)?;
    if path.exists() {
        let contents = fs::read_to_string(&path)
            .with_context(|| format!("reading config at {}", path.display()))?;
        let config: Config = toml::from_str(&contents)
            .with_context(|| format!("parsing config at {}", path.display()))?;
        Ok(config)
    } else {
        let config = Config::default();
        save_config(config_dir, &config)?;
        Ok(config)
    }
}

/// Save the configuration to disk.
pub fn save_config(config_dir: Option<&Path>, config: &Config) -> Result<()> {
    let path = config_path(config_dir)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating config dir {}", parent.display()))?;
    }
    let contents = toml::to_string_pretty(config).context("serializing config")?;
    fs::write(&path, contents).with_context(|| format!("writing config to {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_home() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_path("~/.config").unwrap(), home.join(".config"));
    }

    #[test]
    fn test_config_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let config = Config {
            device_name: "test-device".to_string(),
            ..Default::default()
        };
        save_config(Some(tmp.path()), &config).unwrap();
        let loaded = load_config(Some(tmp.path())).unwrap();
        assert_eq!(loaded.device_name, "test-device");
    }
}

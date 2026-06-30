use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::config::{project_dirs, Config};

/// Persisted local state for peersync.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct State {
    /// Human-readable device name.
    pub device_name: String,
    /// Hex-encoded 32-byte secret key for the Iroh endpoint.
    pub secret_key: Option<String>,
    /// Hex-encoded namespace id of the sync doc.
    pub namespace_id: Option<String>,
    /// Hex-encoded default author id.
    pub author_id: Option<String>,
    /// Shareable doc ticket for linking other devices.
    pub ticket: Option<String>,
    /// The remote doc ticket this device linked to (raw string).
    ///
    /// Kept so the engine can re-run `start_sync` with the remote peer's
    /// node addresses after a restart — `Docs::open` does not auto-join the
    /// doc's gossip swarm, so without re-syncing the receiver never connects
    /// back to the peer that shared the doc.
    #[serde(default)]
    pub peer_ticket: Option<String>,
}

/// State file path: `~/.local/share/peersync/state.toml`.
pub fn state_path(config_dir: Option<&Path>) -> Result<PathBuf> {
    match config_dir {
        Some(dir) => Ok(dir.join("state.toml")),
        None => {
            let dirs = project_dirs()?;
            Ok(dirs.data_dir().to_path_buf().join("state.toml"))
        }
    }
}

/// Iroh data directory.
///
/// If `data_dir` is provided it is used; otherwise `config_dir` is used as a
/// fallback. When neither is given the platform-specific project data dir is
/// used (`~/.local/share/peersync/iroh-data` on Linux).
pub fn iroh_data_dir(config_dir: Option<&Path>, data_dir: Option<&Path>) -> Result<PathBuf> {
    if let Some(dir) = data_dir {
        Ok(dir.join("iroh-data"))
    } else if let Some(dir) = config_dir {
        Ok(dir.join("iroh-data"))
    } else {
        let dirs = project_dirs()?;
        Ok(dirs.data_dir().to_path_buf().join("iroh-data"))
    }
}

/// Load state from disk, or initialize from the user config.
pub fn load_state(config: &Config, config_dir: Option<&Path>) -> Result<State> {
    let path = state_path(config_dir)?;
    if path.exists() {
        let contents = fs::read_to_string(&path)
            .with_context(|| format!("reading state at {}", path.display()))?;
        let mut state: State = toml::from_str(&contents)
            .with_context(|| format!("parsing state at {}", path.display()))?;
        // Allow config file to override the stored device name.
        if !config.device_name.is_empty() {
            state.device_name = config.device_name.clone();
        }
        Ok(state)
    } else {
        Ok(State {
            device_name: config.device_name.clone(),
            ..Default::default()
        })
    }
}

/// Save state to disk.
pub fn save_state(config_dir: Option<&Path>, state: &State) -> Result<()> {
    let path = state_path(config_dir)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating state dir {}", parent.display()))?;
    }
    let contents = toml::to_string_pretty(state).context("serializing state")?;
    fs::write(&path, contents).with_context(|| format!("writing state to {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let config = Config::default();
        let mut state = load_state(&config, Some(tmp.path())).unwrap();
        state.secret_key = Some("abc123".to_string());
        save_state(Some(tmp.path()), &state).unwrap();
        let loaded = load_state(&config, Some(tmp.path())).unwrap();
        assert_eq!(loaded.secret_key, Some("abc123".to_string()));
    }
}

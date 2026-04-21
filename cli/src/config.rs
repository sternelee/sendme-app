//! Configuration management for sendme CLI cloud connectivity.
//!
//! Config file location: `~/.config/sendme/config.toml`
//! Environment variable `SENDME_API_KEY` overrides the file config.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const DEFAULT_API_ORIGIN: &str = "https://sendme.leeapp.dev";

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Config {
    pub api_key: Option<String>,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub api_origin: Option<String>,
}

impl Config {
    /// Load config from file, with env var overrides.
    pub fn load() -> Result<Self> {
        let path = config_path();
        let mut config = if path.exists() {
            let content = std::fs::read_to_string(&path)
                .with_context(|| format!("Failed to read config at {}", path.display()))?;
            toml::from_str(&content)
                .with_context(|| format!("Failed to parse config at {}", path.display()))?
        } else {
            Config::default()
        };

        // Env var overrides
        if let Ok(key) = std::env::var("SENDME_API_KEY") {
            config.api_key = Some(key);
        }
        if let Ok(origin) = std::env::var("SENDME_API_ORIGIN") {
            config.api_origin = Some(origin);
        }

        Ok(config)
    }

    /// Save config to file.
    pub fn save(&self) -> Result<()> {
        let path = config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = toml::to_string_pretty(self)?;
        std::fs::write(&path, content)?;
        Ok(())
    }

    /// Get the API origin URL (defaults to production).
    pub fn api_origin(&self) -> &str {
        self.api_origin.as_deref().unwrap_or(DEFAULT_API_ORIGIN)
    }

    /// Get the device ID, generating one if needed.
    pub fn get_or_create_device_id(&mut self) -> String {
        if let Some(ref id) = self.device_id {
            id.clone()
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            self.device_id = Some(id.clone());
            id
        }
    }

    /// Get the device name, defaulting to hostname.
    pub fn get_device_name(&self) -> String {
        self.device_name
            .clone()
            .unwrap_or_else(|| gethostname().unwrap_or_else(|| "sendme-cli".to_string()))
    }
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sendme")
        .join("config.toml")
}

fn gethostname() -> Option<String> {
    hostname::get().ok()?.into_string().ok()
}

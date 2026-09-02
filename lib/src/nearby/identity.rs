//! Per-device LocalSend identity: a self-signed certificate whose SHA-256
//! fingerprint identifies this device to peers.
//!
//! The identity is persisted so the fingerprint stays stable across restarts;
//! peers use it to recognize (and in the future, trust) this device.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

const IDENTITY_FILE: &str = "localsend-identity.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NearbyIdentity {
    /// PEM-encoded self-signed certificate.
    pub cert_pem: String,
    /// PEM-encoded PKCS#8 private key.
    pub private_key_pem: String,
    /// SHA-256 fingerprint of the certificate, uppercase hex.
    pub fingerprint: String,
}

impl NearbyIdentity {
    /// Loads the identity from `dir`, generating and persisting a new one
    /// when missing or unreadable.
    pub fn load_or_create(dir: &Path) -> Result<Self> {
        let path = dir.join(IDENTITY_FILE);
        if let Ok(data) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<NearbyIdentity>(&data) {
                Ok(identity) => return Ok(identity),
                Err(err) => {
                    tracing::warn!(
                        "Discarding unreadable nearby identity {}: {err}",
                        path.display()
                    );
                }
            }
        }

        let generated = localsend::crypto::cert::generate_self_signed()
            .context("failed to generate nearby identity")?;
        let identity = NearbyIdentity {
            cert_pem: generated.certificate_pem,
            private_key_pem: generated.private_key_pem,
            fingerprint: generated.fingerprint,
        };

        std::fs::create_dir_all(dir)
            .with_context(|| format!("failed to create {}", dir.display()))?;
        let data = serde_json::to_string_pretty(&identity)?;
        std::fs::write(&path, data)
            .with_context(|| format!("failed to write {}", path.display()))?;
        // The private key identifies this device; keep it user-readable only.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(identity)
    }
}

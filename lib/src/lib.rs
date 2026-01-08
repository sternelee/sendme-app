//! Sendme library - Core file transfer logic using iroh networking.
//!
//! This library provides the core functionality for sending and receiving files
//! over the internet with NAT hole punching and blake3 verified streaming.

use anyhow::Context;

pub mod export;
pub mod import;
pub mod nearby;
pub mod progress;
pub mod receive;
pub mod send;
pub mod types;

pub use import::get_export_path;
pub use nearby::NearbyDevice;
pub use progress::*;
pub use types::*;

// Re-export commonly used types from dependencies
pub use iroh::{RelayUrl, SecretKey};
pub use iroh_blobs::{ticket::BlobTicket, BlobFormat, Hash};

// Public API
pub use receive::{receive, receive_with_progress};
pub use send::{send, send_with_progress};

/// Get or create a secret key for the iroh endpoint.
///
/// If the `IROH_SECRET` environment variable is set, it will be parsed as a secret key.
/// Otherwise, a new random secret key will be generated.
pub fn get_or_create_secret(verbose: bool) -> anyhow::Result<SecretKey> {
    match std::env::var("IROH_SECRET") {
        Ok(secret) => {
            let bytes = hex::decode(secret).context("invalid hex in secret")?;
            let bytes: [u8; 32] = bytes
                .try_into()
                .map_err(|_| anyhow::anyhow!("secret key must be 32 bytes"))?;
            Ok(SecretKey::from_bytes(&bytes))
        }
        Err(_) => {
            let key = SecretKey::generate(&mut rand::rng());
            if verbose {
                let key = hex::encode(key.to_bytes());
                eprintln!("using secret key {key}");
            }
            Ok(key)
        }
    }
}

/// Convert a canonicalized path to a string.
///
/// If `must_be_relative` is true, the function will fail if any component of the path is
/// `Component::RootDir`.
///
/// This function will also fail if the path is non-canonical, i.e. contains `..` or `.`,
/// or if the path components contain any path separators.
pub fn canonicalized_path_to_string(
    path: impl AsRef<std::path::Path>,
    must_be_relative: bool,
) -> anyhow::Result<String> {
    use std::path::Component;

    let mut path_str = String::new();
    let parts = path
        .as_ref()
        .components()
        .filter_map(|c| match c {
            Component::Normal(x) => {
                let c = match x.to_str() {
                    Some(c) => c,
                    None => return Some(Err(anyhow::anyhow!("invalid character in path"))),
                };

                if !c.contains('/') && !c.contains('\\') {
                    Some(Ok(c))
                } else {
                    Some(Err(anyhow::anyhow!("invalid path component {:?}", c)))
                }
            }
            Component::RootDir => {
                if must_be_relative {
                    Some(Err(anyhow::anyhow!("invalid path component {:?}", c)))
                } else {
                    path_str.push('/');
                    None
                }
            }
            _ => Some(Err(anyhow::anyhow!("invalid path component {:?}", c))),
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let parts = parts.join("/");
    path_str.push_str(&parts);
    Ok(path_str)
}

/// Validate a path component.
///
/// Ensures the component does not contain path separators.
pub fn validate_path_component(component: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !component.contains('/'),
        "path components must not contain the path separator /"
    );
    Ok(())
}

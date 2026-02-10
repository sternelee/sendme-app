//! Core types for the sendmd library.

use std::{fmt::Display, net::SocketAddrV4, net::SocketAddrV6, path::PathBuf, str::FromStr};

use derive_more::{Display, FromStr};
use iroh::{RelayMode, RelayUrl, TransportAddr};
use iroh_blobs::ticket::BlobTicket;
use serde::{Deserialize, Serialize};

/// Output format for hashes.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    #[default]
    Hex,
    Cid,
}

impl FromStr for Format {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "hex" => Ok(Format::Hex),
            "cid" => Ok(Format::Cid),
            _ => Err(anyhow::anyhow!("invalid format")),
        }
    }
}

impl Display for Format {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Format::Hex => write!(f, "hex"),
            Format::Cid => write!(f, "cid"),
        }
    }
}

/// Options for configuring what is included in an EndpointAddr.
#[derive(Copy, Clone, PartialEq, Eq, Default, Debug, Display, FromStr, Serialize, Deserialize)]
pub enum AddrInfoOptions {
    /// Only the Endpoint ID is added.
    #[default]
    Id,
    /// Includes the Endpoint ID and both the relay URL, and the direct addresses.
    RelayAndAddresses,
    /// Includes the Endpoint ID and the relay URL.
    Relay,
    /// Includes the Endpoint ID and the direct addresses.
    Addresses,
}

/// Apply options to an endpoint address.
pub fn apply_options(addr: &mut iroh::EndpointAddr, opts: AddrInfoOptions) {
    match opts {
        AddrInfoOptions::Id => {
            addr.addrs = Default::default();
        }
        AddrInfoOptions::RelayAndAddresses => {
            // nothing to do
        }
        AddrInfoOptions::Relay => {
            addr.addrs = addr
                .addrs
                .iter()
                .filter(|addr| matches!(addr, TransportAddr::Relay(_)))
                .cloned()
                .collect();
        }
        AddrInfoOptions::Addresses => {
            addr.addrs = addr
                .addrs
                .iter()
                .filter(|addr| matches!(addr, TransportAddr::Ip(_)))
                .cloned()
                .collect();
        }
    }
}

/// Relay mode configuration.
#[derive(Clone, Debug)]
pub enum RelayModeOption {
    /// Disables relays altogether.
    Disabled,
    /// Uses the default relay servers.
    Default,
    /// Uses a single, custom relay server by URL.
    Custom(RelayUrl),
}

impl FromStr for RelayModeOption {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "disabled" => Ok(Self::Disabled),
            "default" => Ok(Self::Default),
            _ => Ok(Self::Custom(RelayUrl::from_str(s)?)),
        }
    }
}

impl Display for RelayModeOption {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disabled => f.write_str("disabled"),
            Self::Default => f.write_str("default"),
            Self::Custom(url) => url.fmt(f),
        }
    }
}

impl From<RelayModeOption> for RelayMode {
    fn from(value: RelayModeOption) -> Self {
        match value {
            RelayModeOption::Disabled => RelayMode::Disabled,
            RelayModeOption::Default => RelayMode::Default,
            RelayModeOption::Custom(url) => RelayMode::Custom(url.into()),
        }
    }
}

/// Common configuration for send/receive operations.
#[derive(Clone, Debug)]
pub struct CommonConfig {
    /// The IPv4 address that magicsocket will listen on.
    pub magic_ipv4_addr: Option<SocketAddrV4>,
    /// The IPv6 address that magicsocket will listen on.
    pub magic_ipv6_addr: Option<SocketAddrV6>,
    /// Hash output format.
    pub format: Format,
    /// Relay mode configuration.
    pub relay: RelayModeOption,
    /// Whether to show the secret key.
    pub show_secret: bool,
    /// Optional custom temp directory for blob storage.
    /// If None, uses current working directory (not compatible with macOS sandbox).
    pub temp_dir: Option<PathBuf>,
}

impl Default for CommonConfig {
    fn default() -> Self {
        Self {
            magic_ipv4_addr: None,
            magic_ipv6_addr: None,
            format: Format::default(),
            relay: RelayModeOption::Default,
            show_secret: false,
            temp_dir: None,
        }
    }
}

/// Arguments for sending data.
#[derive(Clone, Debug)]
pub struct SendArgs {
    /// Path to the file or directory to send.
    pub path: PathBuf,
    /// What type of ticket to use.
    pub ticket_type: AddrInfoOptions,
    /// Common configuration.
    pub common: CommonConfig,
}

/// Arguments for receiving data.
#[derive(Clone, Debug)]
pub struct ReceiveArgs {
    /// The ticket to use to connect to the sender.
    pub ticket: BlobTicket,
    /// Common configuration.
    pub common: CommonConfig,
    /// Optional export directory for final file location.
    /// If not set, files will be exported to temp_dir.
    pub export_dir: Option<PathBuf>,
}

/// Result from a send operation.
#[derive(Debug)]
pub struct SendResult {
    /// Hash of the collection.
    pub hash: iroh_blobs::Hash,
    /// Collection containing all files.
    pub collection: iroh_blobs::format::collection::Collection,
    /// Total size of all files.
    pub total_size: u64,
    /// Time taken for import.
    pub import_duration: std::time::Duration,
    /// Ticket for receiving the data.
    pub ticket: BlobTicket,
}

/// Result from a receive operation.
#[derive(Debug)]
pub struct ReceiveResult {
    /// Collection that was received.
    pub collection: iroh_blobs::format::collection::Collection,
    /// Total number of files.
    pub total_files: u64,
    /// Total payload size.
    pub payload_size: u64,
    /// Statistics about the transfer.
    pub stats: iroh_blobs::get::Stats,
}

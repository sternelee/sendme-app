//! Device-facing types for nearby (LocalSend-compatible) transfers.

use serde::{Deserialize, Serialize};

/// Device category shown in the UI.
///
/// This is sendme's historical enum, kept for the Tauri command/event
/// contract. It maps onto the LocalSend protocol device types
/// (`mobile`/`desktop`/...) when talking to peers.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    Phone,
    Tablet,
    Laptop,
    Desktop,
    #[default]
    Unknown,
}

impl DeviceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeviceType::Phone => "phone",
            DeviceType::Tablet => "tablet",
            DeviceType::Laptop => "laptop",
            DeviceType::Desktop => "desktop",
            DeviceType::Unknown => "unknown",
        }
    }

    /// The LocalSend protocol device type announced to peers.
    /// `Unknown` maps to `None` (the field is optional on the wire).
    pub fn to_protocol(&self) -> Option<localsend::model::discovery::DeviceType> {
        use localsend::model::discovery::DeviceType as Ls;
        match self {
            DeviceType::Phone | DeviceType::Tablet => Some(Ls::Mobile),
            DeviceType::Laptop | DeviceType::Desktop => Some(Ls::Desktop),
            DeviceType::Unknown => None,
        }
    }

    /// Maps a LocalSend protocol device type back to the display enum.
    /// Lossy: the protocol has no phone/tablet/laptop distinction.
    pub fn from_protocol(value: Option<&localsend::model::discovery::DeviceType>) -> Self {
        use localsend::model::discovery::DeviceType as Ls;
        match value {
            Some(Ls::Mobile) => DeviceType::Phone,
            Some(Ls::Desktop) => DeviceType::Desktop,
            _ => DeviceType::Unknown,
        }
    }
}

impl From<&str> for DeviceType {
    fn from(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "phone" => DeviceType::Phone,
            "tablet" => DeviceType::Tablet,
            "laptop" => DeviceType::Laptop,
            "desktop" => DeviceType::Desktop,
            _ => DeviceType::Unknown,
        }
    }
}

/// A device discovered on the local network.
///
/// Serialized camelCase to match the frontend contract
/// (`app/src/bindings.ts` `NearbyDevice`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyDevice {
    /// Stable identifier: the LocalSend fingerprint (SHA-256 of the peer's
    /// certificate in HTTPS mode).
    pub id: String,
    /// Display name (LocalSend `alias`).
    pub name: String,
    pub device_type: DeviceType,
    /// Known reachability hints, rendered as `host:port`.
    pub addresses: Vec<String>,
}

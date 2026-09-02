//! Nearby (LAN) discovery and transfer over the LocalSend protocol.
//!
//! Replaces the previous mDNS + iroh implementation. Interoperates with
//! official LocalSend clients: discovery via UDP multicast (group
//! `224.0.0.167:53317`), transfers over HTTPS with self-signed device
//! certificates, protocol version 2.2.

mod identity;
mod runtime;
mod types;

pub use identity::NearbyIdentity;
pub use runtime::{
    IncomingFile, NearbyEvent, NearbyIncomingDecision, NearbyPrepareError, NearbyRuntime,
    NearbyRuntimeConfig, NearbySendEvent, NearbySendSession, OutgoingFile, ReceiveOutcome,
    ReceiveRequest, DEFAULT_PORT,
};
pub use types::{DeviceType, NearbyDevice};

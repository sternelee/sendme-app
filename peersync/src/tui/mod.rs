//! Terminal UI for PeerSync.
//!
//! Mirrors the PeerSync tab from the sendme CLI TUI but as a standalone
//! interactive application with its own event loop and rendering pipeline.

pub mod app;
pub mod event;
pub mod ui;

pub use app::App;
pub use event::EventHandler;

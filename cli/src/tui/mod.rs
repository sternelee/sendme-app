//! TUI module for sendme CLI.

pub mod app;
pub mod event;
mod ui;

pub mod tabs;

pub use app::{App, Transfer};
pub use event::EventHandler;
pub use ui::render_ui;

//! Event system for the PeerSync TUI.

use crossterm::event::{Event as CrosstermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use std::sync::mpsc;
use std::time::Duration;

/// Application events.
#[derive(Debug, Clone)]
pub enum AppEvent {
    /// Keyboard input.
    Input(KeyEvent),
    /// Bracketed paste from terminal (Ctrl+V / Cmd+V).
    Paste(String),
    /// Periodic tick for UI refresh.
    Tick,
    /// PeerSync status collected.
    StatusUpdated(peersync::status::StatusInfo),
    /// PeerSync log records refreshed.
    LogUpdated(Vec<peersync::history::SyncRecord>),
    /// Engine started successfully.
    EngineStarted,
    /// Engine stopped (gracefully or on error).
    EngineStopped,
    /// Notification / warning message.
    Notification(String),
    /// Doc ticket surfaced.
    Ticket(String),
    /// Link operation completed.
    LinkCompleted { success: bool },
}

/// Event handler: polls crossterm events on a background thread and feeds
/// them through an mpsc channel.
#[derive(Clone)]
pub struct EventHandler {
    sender: mpsc::Sender<AppEvent>,
}

impl EventHandler {
    pub fn new(tick_rate_ms: u64) -> (Self, mpsc::Receiver<AppEvent>) {
        let (tx, rx) = mpsc::channel();

        let tx_clone = tx.clone();
        std::thread::spawn(move || loop {
            if crossterm::event::poll(Duration::from_millis(tick_rate_ms)).unwrap_or(false) {
                match crossterm::event::read() {
                    Ok(CrosstermEvent::Key(key)) if key.kind == KeyEventKind::Press => {
                        let _ = tx_clone.send(AppEvent::Input(key));
                    }
                    Ok(CrosstermEvent::Paste(text)) => {
                        let _ = tx_clone.send(AppEvent::Paste(text));
                    }
                    Ok(CrosstermEvent::Resize(_, _)) => {}
                    _ => {}
                }
            }
            let _ = tx_clone.send(AppEvent::Tick);
        });

        (Self { sender: tx }, rx)
    }

    /// Emit any AppEvent. Lossy — drops if channel is full.
    pub fn emit(&self, event: AppEvent) {
        let _ = self.sender.send(event);
    }
}

/// Check whether a key event means the user wants to quit.
pub fn should_quit(key: &KeyEvent) -> bool {
    matches!(
        (key.code, key.modifiers),
        (KeyCode::Char('q'), KeyModifiers::NONE | KeyModifiers::SHIFT)
            | (KeyCode::Char('c'), KeyModifiers::CONTROL)
    )
}

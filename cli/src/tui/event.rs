//! Event system for the TUI.

use crossterm::event::{Event as CrosstermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use sendme_lib::progress::ProgressEvent;
use std::sync::mpsc;
use std::time::Duration;

/// Application events.
#[derive(Debug, Clone)]
pub enum AppEvent {
    /// Input event.
    Input(KeyEvent),
    /// Tick event for periodic updates.
    Tick,
    /// Transfer progress update.
    TransferUpdate(ProgressEvent),
    /// Send completed with ticket.
    SendCompleted { ticket: String, path: String },
}

/// Event handler for the application.
#[derive(Clone)]
pub struct EventHandler {
    /// Event sender channel.
    sender: mpsc::Sender<AppEvent>,
}

impl EventHandler {
    /// Create a new event handler.
    pub fn new(tick_rate_ms: u64) -> (Self, mpsc::Receiver<AppEvent>) {
        let (sender, receiver) = mpsc::channel();

        // Spawn a thread to handle crossterm events
        let sender_clone = sender.clone();
        std::thread::spawn(move || {
            loop {
                if crossterm::event::poll(Duration::from_millis(tick_rate_ms)).unwrap_or(false) {
                    match crossterm::event::read() {
                        Ok(CrosstermEvent::Key(key)) => {
                            // Only process key press events, not release/repeat
                            if key.kind == KeyEventKind::Press {
                                sender_clone.send(AppEvent::Input(key)).unwrap();
                            }
                        }
                        Ok(CrosstermEvent::Resize(_, _)) => {
                            // Terminal resize - the next render will handle it
                        }
                        _ => {}
                    }
                }
                // Send tick event
                sender_clone.send(AppEvent::Tick).unwrap();
            }
        });

        (Self { sender }, receiver)
    }

    /// Get the next event.
    pub fn next(&self, receiver: &mpsc::Receiver<AppEvent>) -> Result<AppEvent, mpsc::RecvError> {
        receiver.recv()
    }

    /// Send a transfer update event.
    pub fn send_transfer_update(&self, event: ProgressEvent) {
        let _ = self.sender.send(AppEvent::TransferUpdate(event));
    }

    /// Send a send completed event with ticket.
    pub fn send_send_completed(&self, ticket: String, path: String) {
        let _ = self.sender.send(AppEvent::SendCompleted { ticket, path });
    }
}

/// Helper function to check if a key event is a quit command.
pub fn should_quit(key: &KeyEvent) -> bool {
    matches!(
        (key.code, key.modifiers),
        (KeyCode::Char('q'), _) | (KeyCode::Char('c'), KeyModifiers::CONTROL)
    )
}

/// Helper function to check if a key is a tab switch.
pub fn get_tab_switch(key: &KeyEvent) -> Option<usize> {
    match key.code {
        KeyCode::Char('1') => Some(0),
        KeyCode::Char('2') => Some(1),
        KeyCode::Char('3') => Some(2),
        _ => None,
    }
}

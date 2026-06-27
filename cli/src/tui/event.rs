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
    /// Bracketed paste from the terminal (Ctrl+V / Cmd+V).
    Paste(String),
    /// Tick event for periodic updates.
    Tick,
    /// Transfer progress update (includes transfer ID to avoid updating all transfers).
    TransferUpdate {
        transfer_id: String,
        event: ProgressEvent,
    },
    /// Send completed with ticket.
    SendCompleted {
        transfer_id: String,
        ticket: String,
        path: String,
    },
    // --- Cloud events ---
    /// WebSocket connection established.
    CloudConnected,
    /// WebSocket connection lost.
    CloudDisconnected,
    /// Fresh device list from the server.
    CloudDevicesUpdated(Vec<crate::cloud::Device>),
    /// Fresh friend list from the server.
    CloudFriendsUpdated(Vec<crate::cloud::WsFriend>),
    /// Fresh pending-ticket list from the server.
    CloudTicketsUpdated(Vec<crate::cloud::Ticket>),
    /// Toast-style notification (e.g. "file downloaded by recipient").
    CloudNotification(String),
    /// This device's database ID returned after registration.
    CloudDeviceRegistered(String),
    // --- PeerSync events ---
    /// PeerSync status collected.
    PeerSyncStatusUpdated(peersync::status::StatusInfo),
    /// PeerSync log records refreshed.
    PeerSyncLogUpdated(Vec<peersync::history::SyncRecord>),
    /// PeerSync engine started.
    PeerSyncEngineStarted,
    /// PeerSync engine stopped.
    PeerSyncEngineStopped,
    /// PeerSync notification message.
    PeerSyncNotification(String),
    /// PeerSync doc ticket generated at startup.
    PeerSyncTicket(String),
    /// PeerSync link operation completed.
    PeerSyncLinkCompleted { success: bool },
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
                        Ok(CrosstermEvent::Paste(text)) => {
                            sender_clone.send(AppEvent::Paste(text)).unwrap();
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

    /// Send a transfer update event for a specific transfer.
    pub fn send_transfer_update(&self, transfer_id: String, event: ProgressEvent) {
        let _ = self
            .sender
            .send(AppEvent::TransferUpdate { transfer_id, event });
    }

    /// Send a send completed event with ticket.
    pub fn send_send_completed(&self, transfer_id: String, ticket: String, path: String) {
        let _ = self.sender.send(AppEvent::SendCompleted {
            transfer_id,
            ticket,
            path,
        });
    }

    /// Emit any AppEvent (used by background tasks such as the WS listener).
    pub fn emit(&self, event: AppEvent) {
        let _ = self.sender.send(event);
    }
}

/// Helper function to check if a key event is a quit command.
pub fn should_quit(key: &KeyEvent) -> bool {
    matches!(
        (key.code, key.modifiers),
        (KeyCode::Char('q'), KeyModifiers::NONE | KeyModifiers::SHIFT)
            | (KeyCode::Char('c'), KeyModifiers::CONTROL)
    )
}

/// Helper function to check if a key is a tab switch.
pub fn get_tab_switch(key: &KeyEvent) -> Option<usize> {
    match key.code {
        KeyCode::Char('1') => Some(0),
        KeyCode::Char('2') => Some(1),
        KeyCode::Char('3') => Some(2),
        KeyCode::Char('4') => Some(3),
        KeyCode::Char('5') => Some(4),
        _ => None,
    }
}

//! Application state and logic for the TUI.

use crate::tui::file_search::FileSearchPopup;
use sendme_lib::progress::{DownloadProgress, ProgressEvent};
use sendme_lib::Hash;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Current tab in the application.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Send,
    Receive,
    Transfers,
}

impl Tab {
    #[allow(dead_code)]
    /// Get all tabs in order.
    pub fn all() -> &'static [Tab] {
        &[Tab::Send, Tab::Receive, Tab::Transfers]
    }

    /// Get tab index.
    pub fn index(&self) -> usize {
        match self {
            Tab::Send => 0,
            Tab::Receive => 1,
            Tab::Transfers => 2,
        }
    }

    /// Get tab from index.
    pub fn from_index(index: usize) -> Option<Self> {
        match index {
            0 => Some(Tab::Send),
            1 => Some(Tab::Receive),
            2 => Some(Tab::Transfers),
            _ => None,
        }
    }

    /// Get tab name.
    pub fn name(&self) -> &str {
        match self {
            Tab::Send => "Send",
            Tab::Receive => "Receive",
            Tab::Transfers => "Transfers",
        }
    }
}

/// Transfer type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferType {
    Send,
    Receive,
}

impl TransferType {
    pub fn name(&self) -> &str {
        match self {
            TransferType::Send => "Send",
            TransferType::Receive => "Receive",
        }
    }
}

/// Transfer status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferStatus {
    Initializing,
    Serving,
    Connecting,
    Downloading,
    Exporting,
    Completed,
    Error(String),
    Cancelled,
}

impl TransferStatus {
    #[allow(dead_code)]
    pub fn is_active(&self) -> bool {
        matches!(
            self,
            TransferStatus::Initializing
                | TransferStatus::Serving
                | TransferStatus::Connecting
                | TransferStatus::Downloading
                | TransferStatus::Exporting
        )
    }

    pub fn is_finished(&self) -> bool {
        matches!(
            self,
            TransferStatus::Completed | TransferStatus::Error(_) | TransferStatus::Cancelled
        )
    }
}

impl std::fmt::Display for TransferStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransferStatus::Initializing => write!(f, "Initializing..."),
            TransferStatus::Serving => write!(f, "Serving (waiting for peer)"),
            TransferStatus::Connecting => write!(f, "Connecting..."),
            TransferStatus::Downloading => write!(f, "Downloading..."),
            TransferStatus::Exporting => write!(f, "Exporting files..."),
            TransferStatus::Completed => write!(f, "Completed"),
            TransferStatus::Error(msg) => write!(f, "Error: {}", msg),
            TransferStatus::Cancelled => write!(f, "Cancelled"),
        }
    }
}

/// A single transfer.
#[derive(Debug, Clone)]
pub struct Transfer {
    /// Unique ID for this transfer.
    pub id: String,
    /// Transfer type.
    pub transfer_type: TransferType,
    /// Path being sent/received.
    pub path: String,
    /// Current status.
    pub status: TransferStatus,
    /// Ticket (if available).
    pub ticket: Option<String>,
    /// Collection hash.
    pub hash: Option<Hash>,
    /// Total bytes.
    pub total_bytes: u64,
    /// Transferred bytes.
    pub transferred_bytes: u64,
    /// Total files.
    pub total_files: u64,
    /// Transferred files.
    pub transferred_files: u64,
    /// Creation timestamp.
    pub created_at: i64,
    /// Progress percentage (0-100).
    pub progress: u16,
    /// File names in the collection (for receive transfers).
    pub file_names: Vec<String>,
}

impl Transfer {
    /// Create a new transfer.
    pub fn new(transfer_type: TransferType, path: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            transfer_type,
            path,
            status: TransferStatus::Initializing,
            ticket: None,
            hash: None,
            total_bytes: 0,
            transferred_bytes: 0,
            total_files: 0,
            transferred_files: 0,
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64,
            progress: 0,
            file_names: Vec::new(),
        }
    }

    /// Update transfer progress based on progress event.
    pub fn update_progress(&mut self, event: &ProgressEvent) {
        match event {
            ProgressEvent::Download(DownloadProgress::Metadata {
                total_size,
                file_count,
                names,
            }) => {
                self.total_bytes = *total_size;
                self.total_files = *file_count;
                self.file_names = names.clone();
                self.status = TransferStatus::Downloading;
            }
            ProgressEvent::Download(DownloadProgress::Downloading { offset, total }) => {
                self.transferred_bytes = *offset;
                self.total_bytes = *total;
                self.progress = if *total > 0 {
                    (*offset as f64 / *total as f64 * 100.0) as u16
                } else {
                    0
                };
            }
            ProgressEvent::Download(DownloadProgress::Completed) => {
                self.status = TransferStatus::Completed;
                self.progress = 100;
            }
            ProgressEvent::Download(DownloadProgress::Connecting) => {
                self.status = TransferStatus::Connecting;
            }
            ProgressEvent::Import(_, progress) => match progress {
                sendme_lib::progress::ImportProgress::Started { total_files } => {
                    self.total_files = *total_files as u64;
                }
                sendme_lib::progress::ImportProgress::FileCompleted { .. } => {
                    self.transferred_files += 1;
                }
                sendme_lib::progress::ImportProgress::Completed { total_size } => {
                    self.total_bytes = *total_size;
                    self.status = TransferStatus::Serving;
                }
                _ => {}
            },
            ProgressEvent::Export(_, progress) => {
                self.status = TransferStatus::Exporting;
                match progress {
                    sendme_lib::progress::ExportProgress::Started { total_files } => {
                        self.total_files = *total_files as u64;
                    }
                    sendme_lib::progress::ExportProgress::FileCompleted { .. } => {
                        self.transferred_files += 1;
                    }
                    sendme_lib::progress::ExportProgress::Completed => {
                        self.status = TransferStatus::Completed;
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

/// Send tab state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendTabState {
    /// Showing file input field.
    Input,
    /// Showing success view with ticket/QR.
    Success,
    /// Showing file search popup.
    FileSearch,
}

/// Transfers tab state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransfersTabState {
    /// Showing the list of transfers.
    List,
    /// Showing detail view with ticket/QR for selected transfer.
    Detail { transfer_id: String },
}

/// Main application state.
pub struct App {
    /// Current active tab.
    pub current_tab: Tab,
    /// List of all transfers.
    pub transfers: Vec<Transfer>,

    // Send tab state
    /// Current state of the send tab.
    pub send_tab_state: SendTabState,
    /// Input path for sending.
    pub send_input_path: String,
    /// Message for send tab.
    pub send_message: String,
    /// Ticket string for success view.
    pub send_success_ticket: Option<String>,
    /// File path for success view.
    pub send_success_path: Option<String>,
    /// Show QR code flag (legacy, kept for compatibility).
    pub show_qr: bool,
    /// File search popup state.
    pub send_file_search: Option<FileSearchPopup>,

    // Receive tab state
    /// Input ticket for receiving.
    pub receive_input_ticket: String,
    /// Message for receive tab.
    pub receive_message: String,

    // Transfers tab state
    /// Current state of the transfers tab.
    pub transfers_tab_state: TransfersTabState,
    /// Index of currently selected transfer.
    pub selected_transfer_index: Option<usize>,

    /// Application running flag.
    pub running: bool,
}

impl App {
    /// Create a new application instance.
    pub fn new() -> Self {
        Self {
            current_tab: Tab::Send,
            transfers: Vec::new(),
            send_tab_state: SendTabState::Input,
            send_input_path: String::new(),
            send_message: String::new(),
            send_success_ticket: None,
            send_success_path: None,
            show_qr: false,
            send_file_search: None,
            receive_input_ticket: String::new(),
            receive_message: String::new(),
            transfers_tab_state: TransfersTabState::List,
            selected_transfer_index: None,
            running: true,
        }
    }

    #[allow(dead_code)]
    /// Update application state based on a progress event.
    pub fn update_progress(&mut self, event: &ProgressEvent, transfer_id: &str) {
        if let Some(transfer) = self.transfers.iter_mut().find(|t| t.id == transfer_id) {
            transfer.update_progress(event);
        }
    }

    /// Handle a key event.
    pub fn handle_key(&mut self, key: crossterm::event::KeyEvent) {
        if let Some(index) = crate::tui::event::get_tab_switch(&key) {
            if let Some(tab) = Tab::from_index(index) {
                self.current_tab = tab;
                return;
            }
        }

        if crate::tui::event::should_quit(&key) {
            self.running = false;
            return;
        }

        // Handle ESC key - returns to input/list view from success/detail views
        if key.code == crossterm::event::KeyCode::Esc {
            match self.current_tab {
                Tab::Send => {
                    if self.send_tab_state == SendTabState::Success {
                        self.send_tab_state = SendTabState::Input;
                        self.send_input_path.clear();
                        self.send_success_ticket = None;
                        self.send_success_path = None;
                    } else if self.send_tab_state == SendTabState::FileSearch {
                        self.close_file_search();
                    }
                }
                Tab::Transfers => {
                    if let TransfersTabState::Detail { .. } = &self.transfers_tab_state {
                        self.transfers_tab_state = TransfersTabState::List;
                    }
                }
                _ => {}
            }
            return;
        }

        // Handle tab-specific input
        match self.current_tab {
            Tab::Send => self.handle_send_tab_key(key),
            Tab::Receive => self.handle_receive_tab_key(key),
            Tab::Transfers => self.handle_transfers_tab_key(key),
        }
    }

    /// Handle key events in the send tab.
    fn handle_send_tab_key(&mut self, key: crossterm::event::KeyEvent) {
        match self.send_tab_state {
            SendTabState::Input => {
                match key.code {
                    // Open file search popup with '@' key
                    crossterm::event::KeyCode::Char('@') => {
                        self.open_file_search();
                    }
                    crossterm::event::KeyCode::Char(c) => {
                        self.send_input_path.push(c);
                    }
                    crossterm::event::KeyCode::Backspace => {
                        self.send_input_path.pop();
                    }
                    crossterm::event::KeyCode::Enter => {
                        if !self.send_input_path.is_empty() {
                            // Import will be handled externally, just set message for now
                            self.send_message = format!("Sending: {}", self.send_input_path);
                        }
                    }
                    _ => {}
                }
            }
            SendTabState::FileSearch => {
                self.handle_file_search_key(key);
            }
            SendTabState::Success => {
                // Handle 'C' key to copy ticket
                if key.code == crossterm::event::KeyCode::Char('c')
                    || key.code == crossterm::event::KeyCode::Char('C')
                {
                    if let Some(ticket) = self.send_success_ticket.clone() {
                        self.copy_to_clipboard(&ticket);
                    }
                }
                // ESC handled in main handler
            }
        }
    }

    /// Handle key events in the receive tab.
    fn handle_receive_tab_key(&mut self, key: crossterm::event::KeyEvent) {
        match key.code {
            crossterm::event::KeyCode::Char(c) => {
                self.receive_input_ticket.push(c);
            }
            crossterm::event::KeyCode::Backspace => {
                self.receive_input_ticket.pop();
            }
            crossterm::event::KeyCode::Enter => {
                if !self.receive_input_ticket.is_empty() {
                    self.receive_message = format!("Receiving from ticket...");
                }
            }
            _ => {}
        }
    }

    /// Handle key events in the transfers tab.
    fn handle_transfers_tab_key(&mut self, key: crossterm::event::KeyEvent) {
        match &self.transfers_tab_state {
            TransfersTabState::List => {
                match key.code {
                    crossterm::event::KeyCode::Up => {
                        if self.transfers.is_empty() {
                            self.selected_transfer_index = None;
                        } else {
                            let new_idx = match self.selected_transfer_index {
                                None => Some(self.transfers.len().saturating_sub(1)),
                                Some(0) => Some(self.transfers.len().saturating_sub(1)),
                                Some(idx) => Some(idx - 1),
                            };
                            self.selected_transfer_index = new_idx;
                        }
                    }
                    crossterm::event::KeyCode::Down => {
                        if self.transfers.is_empty() {
                            self.selected_transfer_index = None;
                        } else {
                            let new_idx = match self.selected_transfer_index {
                                None => Some(0),
                                Some(idx) if idx >= self.transfers.len().saturating_sub(1) => {
                                    Some(0)
                                }
                                Some(idx) => Some(idx + 1),
                            };
                            self.selected_transfer_index = new_idx;
                        }
                    }
                    crossterm::event::KeyCode::Enter => {
                        if let Some(idx) = self.selected_transfer_index {
                            if let Some(transfer) = self.transfers.get(idx) {
                                if transfer.ticket.is_some() {
                                    self.transfers_tab_state = TransfersTabState::Detail {
                                        transfer_id: transfer.id.clone(),
                                    };
                                }
                            }
                        }
                    }
                    crossterm::event::KeyCode::Char('d') => {
                        if let Some(idx) = self.selected_transfer_index {
                            if idx < self.transfers.len() {
                                self.transfers.remove(idx);
                                // Reset or adjust selection
                                if self.transfers.is_empty() {
                                    self.selected_transfer_index = None;
                                } else if idx >= self.transfers.len() {
                                    self.selected_transfer_index =
                                        Some(self.transfers.len().saturating_sub(1));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            TransfersTabState::Detail { .. } => {
                // Handle 'C' key to copy ticket
                if key.code == crossterm::event::KeyCode::Char('c')
                    || key.code == crossterm::event::KeyCode::Char('C')
                {
                    if let Some(ticket) = self.get_selected_transfer_ticket() {
                        let ticket = ticket.to_string();
                        self.copy_to_clipboard(&ticket);
                    }
                }
                // ESC handled in main handler
            }
        }
    }

    /// Add a new transfer.
    pub fn add_transfer(&mut self, transfer: Transfer) {
        self.transfers.push(transfer);
    }

    /// Clean up finished transfers.
    pub fn cleanup_finished_transfers(&mut self) {
        self.transfers.retain(|t| !t.status.is_finished());
    }

    /// Set the send tab to success view with ticket.
    pub fn set_send_success(&mut self, ticket: String, path: String) {
        self.send_tab_state = SendTabState::Success;
        self.send_success_ticket = Some(ticket);
        self.send_success_path = Some(path);
        self.send_input_path.clear();
    }

    /// Get the currently selected transfer (if any).
    pub fn get_selected_transfer(&self) -> Option<&Transfer> {
        if let TransfersTabState::Detail { transfer_id } = &self.transfers_tab_state {
            self.transfers.iter().find(|t| t.id == *transfer_id)
        } else {
            self.selected_transfer_index
                .and_then(|idx| self.transfers.get(idx))
        }
    }

    /// Get ticket for the currently selected transfer (if any).
    pub fn get_selected_transfer_ticket(&self) -> Option<&str> {
        self.get_selected_transfer()
            .and_then(|t| t.ticket.as_deref())
    }

    /// Get transfer by ID.
    pub fn get_transfer_by_id(&self, id: &str) -> Option<&Transfer> {
        self.transfers.iter().find(|t| t.id == id)
    }

    /// Copy text to clipboard.
    pub fn copy_to_clipboard(&mut self, text: &str) {
        #[cfg(feature = "clipboard")]
        {
            use crossterm::clipboard::CopyToClipboard;
            use crossterm::execute;
            use std::io::stdout;
            if let Err(e) = execute!(stdout(), CopyToClipboard::to_clipboard_from(text)) {
                self.send_message = format!("Copy failed: {}", e);
            } else {
                self.send_message = "Ticket copied to clipboard!".to_string();
            }
        }

        #[cfg(not(feature = "clipboard"))]
        {
            self.send_message = "Clipboard feature not enabled".to_string();
        }
    }

    /// Get a mutable reference to the clipboard message.
    pub fn clipboard_message(&self) -> &str {
        &self.send_message
    }

    /// Check if there's a clipboard message to show.
    pub fn has_clipboard_message(&self) -> bool {
        self.send_message.contains("copied") || self.send_message.contains("Copy failed")
    }

    /// Open the file search popup.
    pub fn open_file_search(&mut self) {
        use std::env;

        let base_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut popup = FileSearchPopup::new(base_dir);
        popup.refresh_files_sync();
        self.send_tab_state = SendTabState::FileSearch;
        self.send_file_search = Some(popup);
    }

    /// Close the file search popup.
    pub fn close_file_search(&mut self) {
        self.send_tab_state = SendTabState::Input;
        self.send_file_search = None;
    }

    /// Handle key events in the file search popup.
    fn handle_file_search_key(&mut self, key: crossterm::event::KeyEvent) {
        let Some(popup) = &mut self.send_file_search else {
            return;
        };

        match key.code {
            crossterm::event::KeyCode::Char(c) => {
                popup.update_query(c);
            }
            crossterm::event::KeyCode::Backspace => {
                popup.remove_char();
            }
            crossterm::event::KeyCode::Up => {
                popup.move_selection(-1);
            }
            crossterm::event::KeyCode::Down => {
                popup.move_selection(1);
            }
            crossterm::event::KeyCode::Enter => {
                self.select_file_from_search();
            }
            crossterm::event::KeyCode::Esc => {
                self.close_file_search();
            }
            _ => {}
        }
    }

    /// Select a file from the file search popup.
    fn select_file_from_search(&mut self) {
        if let Some(popup) = &self.send_file_search {
            if let Some(path) = popup.selected_path() {
                self.send_input_path = path.to_string_lossy().to_string();
            }
        }
        self.close_file_search();
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

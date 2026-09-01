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
    Cloud,
    PeerSync,
}

impl Tab {
    /// Get all tabs in order.
    pub fn all() -> &'static [Tab] {
        &[
            Tab::Send,
            Tab::Receive,
            Tab::Transfers,
            Tab::Cloud,
            Tab::PeerSync,
        ]
    }

    /// Get tab index.
    pub fn index(&self) -> usize {
        match self {
            Tab::Send => 0,
            Tab::Receive => 1,
            Tab::Transfers => 2,
            Tab::Cloud => 3,
            Tab::PeerSync => 4,
        }
    }

    /// Get tab from index.
    pub fn from_index(index: usize) -> Option<Self> {
        match index {
            0 => Some(Tab::Send),
            1 => Some(Tab::Receive),
            2 => Some(Tab::Transfers),
            3 => Some(Tab::Cloud),
            4 => Some(Tab::PeerSync),
            _ => None,
        }
    }

    /// Get tab name.
    pub fn name(&self) -> &str {
        match self {
            Tab::Send => "Send",
            Tab::Receive => "Receive",
            Tab::Transfers => "Transfers",
            Tab::Cloud => "Cloud",
            Tab::PeerSync => "PeerSync",
        }
    }
}

/// WebSocket connection state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloudWsState {
    /// No API key configured.
    NotLoggedIn,
    /// Attempting to connect.
    Connecting,
    /// Connection is active.
    Connected,
    /// Connection lost; will retry.
    Reconnecting,
}

impl std::fmt::Display for CloudWsState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CloudWsState::NotLoggedIn => write!(f, "Not logged in"),
            CloudWsState::Connecting => write!(f, "Connecting…"),
            CloudWsState::Connected => write!(f, "Connected ●"),
            CloudWsState::Reconnecting => write!(f, "Reconnecting…"),
        }
    }
}

/// Which section of the Cloud tab is active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudSection {
    Devices,
    Friends,
    Incoming,
}

/// Which section of the PeerSync tab is active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerSyncSection {
    Status,
    Targets,
    Log,
    Gc,
}

/// Cloud-send overlay state in the Send tab success view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendCloudState {
    /// No overlay shown.
    None,
    /// Device selector popup is open.
    SelectingDevice,
    /// Friend selector popup is open.
    SelectingFriend,
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

    // Cloud tab state
    /// WebSocket connection state.
    pub cloud_ws_state: CloudWsState,
    /// This device's DB-assigned ID (set after registration).
    pub cloud_my_device_db_id: Option<String>,
    /// My own devices as returned by the server.
    pub cloud_devices: Vec<crate::cloud::Device>,
    /// Friends with their devices as returned by the server.
    pub cloud_friends: Vec<crate::cloud::WsFriend>,
    /// Pending incoming tickets.
    pub cloud_pending_tickets: Vec<crate::cloud::Ticket>,
    /// Which section of the Cloud tab is currently shown.
    pub cloud_section: CloudSection,
    /// Selected item index within the current cloud section.
    pub cloud_selected_index: usize,
    /// Short-lived notification message shown in Cloud tab.
    pub cloud_notification: Option<String>,

    // Send tab – cloud send overlay
    /// Whether the device/friend selector popup is open.
    pub send_cloud_state: SendCloudState,
    /// Selection index within the cloud send popup.
    pub send_cloud_selected_index: usize,

    // PeerSync tab state
    /// Current section of the PeerSync tab.
    pub peer_sync_section: PeerSyncSection,
    /// Latest collected status info.
    pub peer_sync_status: Option<peersync::status::StatusInfo>,
    /// Configured sync targets (key, target).
    pub peer_sync_targets: Vec<(String, peersync::config::TargetConfig)>,
    /// Cached log records for display.
    pub peer_sync_log: Vec<peersync::history::SyncRecord>,
    /// Shareable doc ticket generated when the engine starts.
    pub peer_sync_ticket: Option<String>,
    /// Whether the sync engine is currently running.
    pub peer_sync_engine_running: bool,
    /// Whether a refresh/gc/engine action is in progress.
    pub peer_sync_busy: bool,
    /// Whether the next GC run should be a dry-run.
    pub peer_sync_gc_dry_run: bool,
    /// Input buffer for adding a new sync target path.
    pub peer_sync_target_input: String,
    /// File search popup for adding targets.
    pub peer_sync_file_search: Option<crate::tui::file_search::FileSearchPopup>,
    /// Whether the PeerSync status is showing the link ticket input.
    pub peer_sync_link_mode: bool,
    /// Input buffer for linking an existing sync doc ticket.
    pub peer_sync_link_input: String,
    /// Flag set when the user cancels (ESC) a link operation so the
    /// background link task knows not to auto-start the engine on success.
    pub peer_sync_link_cancelled: bool,
    /// Selected index in PeerSync lists.
    pub peer_sync_selected_index: usize,
    /// Short-lived notification/message in PeerSync tab.
    pub peer_sync_message: String,

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
            cloud_ws_state: CloudWsState::NotLoggedIn,
            cloud_my_device_db_id: None,
            cloud_devices: Vec::new(),
            cloud_friends: Vec::new(),
            cloud_pending_tickets: Vec::new(),
            cloud_section: CloudSection::Incoming,
            cloud_selected_index: 0,
            cloud_notification: None,
            send_cloud_state: SendCloudState::None,
            send_cloud_selected_index: 0,
            peer_sync_section: PeerSyncSection::Status,
            peer_sync_status: None,
            peer_sync_targets: Vec::new(),
            peer_sync_log: Vec::new(),
            peer_sync_ticket: None,
            peer_sync_engine_running: false,
            peer_sync_busy: false,
            peer_sync_gc_dry_run: false,
            peer_sync_target_input: String::new(),
            peer_sync_file_search: None,
            peer_sync_link_mode: false,
            peer_sync_link_input: String::new(),
            peer_sync_link_cancelled: false,
            peer_sync_selected_index: 0,
            peer_sync_message: String::new(),
            running: true,
        }
    }

    /// Update application state based on a progress event for a specific transfer.
    pub fn update_progress(&mut self, event: &ProgressEvent, transfer_id: &str) {
        if let Some(transfer) = self.transfers.iter_mut().find(|t| t.id == transfer_id) {
            transfer.update_progress(event);
        }
    }

    /// Handle a key event.
    pub fn handle_key(&mut self, key: crossterm::event::KeyEvent) {
        if let Some(index) = crate::tui::event::get_tab_switch(&key) {
            if let Some(tab) = Tab::from_index(index) {
                if tab == Tab::PeerSync {
                    self.load_peer_sync_targets_from_disk();
                }
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
                    if self.send_cloud_state != SendCloudState::None {
                        // Close cloud send popup first
                        self.send_cloud_state = SendCloudState::None;
                    } else if self.send_tab_state == SendTabState::Success {
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
                Tab::PeerSync => {
                    if self.peer_sync_file_search.is_some() {
                        self.close_peer_sync_file_search();
                    } else if self.peer_sync_link_mode {
                        self.peer_sync_link_mode = false;
                        self.peer_sync_link_input.clear();
                        self.peer_sync_link_cancelled = true;
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
            Tab::Cloud => self.handle_cloud_tab_key(key),
            Tab::PeerSync => self.handle_peer_sync_tab_key(key),
        }
    }

    /// Handle a bracketed paste event — inject text into the active input field.
    pub fn handle_paste(&mut self, text: &str) {
        // Sanitize: collapse newlines/tabs into spaces, then trim.
        let cleaned: String = text
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect();
        let cleaned = cleaned.trim();
        if cleaned.is_empty() {
            return;
        }

        match self.current_tab {
            Tab::Send if self.send_tab_state == SendTabState::Input => {
                self.send_input_path.push_str(cleaned);
            }
            Tab::Receive => {
                self.receive_input_ticket.push_str(cleaned);
            }
            Tab::PeerSync if self.peer_sync_link_mode => {
                self.peer_sync_link_input.push_str(cleaned);
            }
            Tab::PeerSync if self.peer_sync_section == PeerSyncSection::Targets => {
                self.peer_sync_target_input.push_str(cleaned);
            }
            _ => {}
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
                    crossterm::event::KeyCode::Enter if !self.send_input_path.is_empty() => {
                        // Import will be handled externally, just set message for now
                        self.send_message = format!("Sending: {}", self.send_input_path);
                    }
                    _ => {}
                }
            }
            SendTabState::FileSearch => {
                self.handle_file_search_key(key);
            }
            SendTabState::Success => {
                match key.code {
                    // 'C' – copy ticket to clipboard
                    crossterm::event::KeyCode::Char('c') | crossterm::event::KeyCode::Char('C')
                        if self.send_cloud_state == SendCloudState::None =>
                    {
                        if let Some(ticket) = self.send_success_ticket.clone() {
                            self.copy_to_clipboard(&ticket);
                        }
                    }
                    // 'D' – open device selector (cloud send)
                    crossterm::event::KeyCode::Char('d') | crossterm::event::KeyCode::Char('D') => {
                        if !self.cloud_devices.is_empty() {
                            self.send_cloud_state = SendCloudState::SelectingDevice;
                            self.send_cloud_selected_index = 0;
                        } else {
                            self.send_message =
                                "No devices available. Log in to use cloud send.".to_string();
                        }
                    }
                    // 'F' – open friend selector (cloud send)
                    crossterm::event::KeyCode::Char('f') | crossterm::event::KeyCode::Char('F') => {
                        if !self.cloud_friends.is_empty() {
                            self.send_cloud_state = SendCloudState::SelectingFriend;
                            self.send_cloud_selected_index = 0;
                        } else {
                            self.send_message =
                                "No friends available. Log in to use cloud send.".to_string();
                        }
                    }
                    // Navigate inside cloud send popup
                    crossterm::event::KeyCode::Up
                        if self.send_cloud_state != SendCloudState::None
                            && self.send_cloud_selected_index > 0 =>
                    {
                        self.send_cloud_selected_index -= 1;
                    }
                    crossterm::event::KeyCode::Down
                        if self.send_cloud_state != SendCloudState::None =>
                    {
                        let max = match self.send_cloud_state {
                            SendCloudState::SelectingDevice => self.cloud_devices.len(),
                            SendCloudState::SelectingFriend => self.cloud_friends.len(),
                            SendCloudState::None => 0,
                        };
                        if self.send_cloud_selected_index + 1 < max {
                            self.send_cloud_selected_index += 1;
                        }
                    }
                    // ESC / Enter in popup are handled in main event loop
                    _ => {}
                }
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
            crossterm::event::KeyCode::Enter if !self.receive_input_ticket.is_empty() => {
                self.receive_message = "Receiving from ticket...".to_string();
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

    /// Handle key events in the Cloud tab.
    pub fn handle_cloud_tab_key(&mut self, key: crossterm::event::KeyEvent) {
        match key.code {
            // Switch sections with letter shortcuts
            crossterm::event::KeyCode::Char('d') | crossterm::event::KeyCode::Char('D') => {
                self.cloud_section = CloudSection::Devices;
                self.cloud_selected_index = 0;
            }
            crossterm::event::KeyCode::Char('f') | crossterm::event::KeyCode::Char('F') => {
                self.cloud_section = CloudSection::Friends;
                self.cloud_selected_index = 0;
            }
            crossterm::event::KeyCode::Char('i') | crossterm::event::KeyCode::Char('I') => {
                self.cloud_section = CloudSection::Incoming;
                self.cloud_selected_index = 0;
            }
            crossterm::event::KeyCode::Up if self.cloud_selected_index > 0 => {
                self.cloud_selected_index -= 1;
            }
            crossterm::event::KeyCode::Down => {
                let max = self.cloud_section_len();
                if self.cloud_selected_index + 1 < max {
                    self.cloud_selected_index += 1;
                }
            }
            // Enter is handled in the main event loop (needs receive_tx)
            _ => {}
        }
    }

    /// Number of items in the currently active cloud section.
    pub fn cloud_section_len(&self) -> usize {
        match self.cloud_section {
            CloudSection::Devices => self.cloud_devices.len(),
            CloudSection::Friends => self.cloud_friends.len(),
            CloudSection::Incoming => self.cloud_pending_tickets.len(),
        }
    }

    /// Handle key events in the PeerSync tab.
    pub fn handle_peer_sync_tab_key(&mut self, key: crossterm::event::KeyEvent) {
        // File search popup takes precedence.
        if self.peer_sync_file_search.is_some() {
            self.handle_peer_sync_file_search_key(key);
            return;
        }

        // Link input mode takes precedence over status navigation.
        if self.peer_sync_link_mode {
            self.handle_peer_sync_link_key(key);
            return;
        }

        match key.code {
            crossterm::event::KeyCode::Char('s') | crossterm::event::KeyCode::Char('S') => {
                self.peer_sync_section = PeerSyncSection::Status;
                self.peer_sync_selected_index = 0;
            }
            crossterm::event::KeyCode::Char('t') | crossterm::event::KeyCode::Char('T') => {
                self.peer_sync_section = PeerSyncSection::Targets;
                self.peer_sync_selected_index = 0;
            }
            crossterm::event::KeyCode::Char('l') | crossterm::event::KeyCode::Char('L') => {
                self.peer_sync_section = PeerSyncSection::Log;
                self.peer_sync_selected_index = 0;
            }
            crossterm::event::KeyCode::Char('g') | crossterm::event::KeyCode::Char('G') => {
                self.peer_sync_section = PeerSyncSection::Gc;
                self.peer_sync_selected_index = 0;
            }
            crossterm::event::KeyCode::Char('r') | crossterm::event::KeyCode::Char('R') => {
                // Refresh is handled by the main event loop.
            }
            crossterm::event::KeyCode::Char('c') | crossterm::event::KeyCode::Char('C') => {
                if self.peer_sync_section == PeerSyncSection::Status {
                    if let Some(ticket) = self.peer_sync_ticket.clone() {
                        self.copy_to_clipboard(&ticket);
                        self.peer_sync_message = "Ticket copied to clipboard".to_string();
                    }
                }
            }
            crossterm::event::KeyCode::Char('o') | crossterm::event::KeyCode::Char('O') => {
                if self.peer_sync_section == PeerSyncSection::Status {
                    self.peer_sync_link_mode = true;
                    self.peer_sync_link_input.clear();
                    self.peer_sync_link_cancelled = false;
                }
            }
            crossterm::event::KeyCode::Char('d') | crossterm::event::KeyCode::Char('D') => {
                if self.peer_sync_section == PeerSyncSection::Gc {
                    self.peer_sync_gc_dry_run = !self.peer_sync_gc_dry_run;
                } else if self.peer_sync_section == PeerSyncSection::Targets {
                    self.remove_peer_sync_target();
                }
            }
            crossterm::event::KeyCode::Up => {
                if self.peer_sync_selected_index > 0 {
                    self.peer_sync_selected_index -= 1;
                }
            }
            crossterm::event::KeyCode::Down => {
                let max = self.peer_sync_list_len();
                if self.peer_sync_selected_index + 1 < max {
                    self.peer_sync_selected_index += 1;
                }
            }
            _ => {
                // Targets section accepts typed paths (also supports terminal paste / OS drag-drop).
                if self.peer_sync_section == PeerSyncSection::Targets {
                    self.handle_peer_sync_target_input_key(key);
                }
            }
        }
    }

    /// Handle key events while the PeerSync link input is active.
    fn handle_peer_sync_link_key(&mut self, key: crossterm::event::KeyEvent) {
        match key.code {
            crossterm::event::KeyCode::Char(c) => self.peer_sync_link_input.push(c),
            crossterm::event::KeyCode::Backspace => {
                self.peer_sync_link_input.pop();
            }
            crossterm::event::KeyCode::Esc => {
                self.peer_sync_link_mode = false;
                self.peer_sync_link_input.clear();
                self.peer_sync_link_cancelled = true;
                // Also clear busy so the user can recover if the link task
                // hung/timed out; the actual link task will still finish in the
                // background and emit PeerSyncLinkCompleted, which is safe to
                // ignore because the cancelled flag prevents auto-starting the
                // engine.
                self.peer_sync_busy = false;
            }
            // Enter is handled by the main loop because it needs async network IO.
            _ => {}
        }
    }

    /// Handle key events while the PeerSync file search popup is open.
    fn handle_peer_sync_file_search_key(&mut self, key: crossterm::event::KeyEvent) {
        let Some(popup) = &mut self.peer_sync_file_search else {
            return;
        };

        match key.code {
            crossterm::event::KeyCode::Char(c) => popup.update_query(c),
            crossterm::event::KeyCode::Backspace => popup.remove_char(),
            crossterm::event::KeyCode::Up => popup.move_selection(-1),
            crossterm::event::KeyCode::Down => popup.move_selection(1),
            crossterm::event::KeyCode::Enter => {
                if let Some(path) = popup.selected_path() {
                    self.add_peer_sync_target(path.to_string_lossy().as_ref());
                }
                self.close_peer_sync_file_search();
            }
            crossterm::event::KeyCode::Esc => self.close_peer_sync_file_search(),
            _ => {}
        }
    }

    /// Handle key events in the PeerSync target path input.
    fn handle_peer_sync_target_input_key(&mut self, key: crossterm::event::KeyEvent) {
        match key.code {
            crossterm::event::KeyCode::Char('@') => self.open_peer_sync_file_search(),
            crossterm::event::KeyCode::Char(c) => self.peer_sync_target_input.push(c),
            crossterm::event::KeyCode::Backspace => {
                self.peer_sync_target_input.pop();
            }
            // Enter is handled by the main event loop so it can respect the
            // peer_sync_busy guard and avoid double-processing.
            _ => {}
        }
    }

    /// Open the file search popup for adding a sync target.
    pub fn open_peer_sync_file_search(&mut self) {
        use std::env;

        let base_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut popup = crate::tui::file_search::FileSearchPopup::new(base_dir);
        popup.refresh_files_sync();
        self.peer_sync_file_search = Some(popup);
    }

    /// Close the file search popup.
    pub fn close_peer_sync_file_search(&mut self) {
        self.peer_sync_file_search = None;
    }

    /// Add a path as a new sync target.
    pub fn add_peer_sync_target(&mut self, path: &str) {
        let expanded = peersync::config::expand_path(path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string());

        // Check if the expanded path is already a target to avoid duplicates.
        if self
            .peer_sync_targets
            .iter()
            .any(|(_, t)| t.src == expanded)
        {
            self.peer_sync_message = format!("Already a target: {}", path);
            return;
        }

        let base_key = std::path::Path::new(&expanded)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("target")
            .to_string();
        // Ensure key uniqueness by appending a suffix if needed.
        let mut key = base_key.clone();
        let mut suffix = 1;
        while self.peer_sync_targets.iter().any(|(k, _)| *k == key) {
            key = format!("{}-{}", base_key, suffix);
            suffix += 1;
        }
        let target = peersync::config::TargetConfig {
            src: expanded,
            ignore: Vec::new(),
            overrides: None,
        };
        self.peer_sync_targets.push((key, target));
        if let Err(e) = self.save_peer_sync_config() {
            self.peer_sync_message = format!("Failed to save config: {}", e);
        } else {
            self.peer_sync_message = format!("Added target: {}", path);
        }
    }

    /// Remove the currently selected sync target.
    pub fn remove_peer_sync_target(&mut self) {
        if self.peer_sync_section != PeerSyncSection::Targets || self.peer_sync_targets.is_empty() {
            return;
        }
        if self.peer_sync_selected_index < self.peer_sync_targets.len() {
            let removed = self.peer_sync_targets.remove(self.peer_sync_selected_index);
            if self.peer_sync_selected_index >= self.peer_sync_targets.len()
                && !self.peer_sync_targets.is_empty()
            {
                self.peer_sync_selected_index = self.peer_sync_targets.len() - 1;
            }
            if let Err(e) = self.save_peer_sync_config() {
                self.peer_sync_message = format!("Failed to save config: {}", e);
            } else {
                self.peer_sync_message = format!("Removed target: {}", removed.0);
            }
        }
    }

    /// Load targets from a peersync config.
    pub fn load_peer_sync_targets(&mut self, config: &peersync::config::Config) {
        self.peer_sync_targets = config
            .targets
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
    }

    /// Load targets from disk.
    pub fn load_peer_sync_targets_from_disk(&mut self) {
        let config_dir = crate::config::peersync_config_dir();
        let _ = crate::config::ensure_peersync_dirs();
        let config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
        self.load_peer_sync_targets(&config);
    }

    /// Persist the current PeerSync targets to disk.
    pub fn save_peer_sync_config(&self) -> anyhow::Result<()> {
        let config_dir = crate::config::peersync_config_dir();
        let mut config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
        config.targets.clear();
        for (key, target) in &self.peer_sync_targets {
            config.targets.insert(key.clone(), target.clone());
        }
        peersync::config::save_config(Some(&config_dir), &config)?;
        Ok(())
    }

    /// Number of selectable items in the current PeerSync section.
    pub fn peer_sync_list_len(&self) -> usize {
        match self.peer_sync_section {
            PeerSyncSection::Status => self.peer_sync_status.as_ref().map_or(0, |s| {
                s.online_peers.len() + s.targets.len() + s.conflict_files.len()
            }),
            PeerSyncSection::Targets => self.peer_sync_targets.len(),
            PeerSyncSection::Log => self.peer_sync_log.len(),
            PeerSyncSection::Gc => 0,
        }
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

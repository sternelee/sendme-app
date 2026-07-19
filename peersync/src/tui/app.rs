//! Application state for the PeerSync TUI.

use std::path::PathBuf;

/// Sections of the PeerSync TUI (rendered as tabs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Section {
    Status,
    Targets,
    Log,
    Gc,
}

impl Section {
    pub fn all() -> &'static [Section] {
        &[Section::Status, Section::Targets, Section::Log, Section::Gc]
    }

    pub fn index(&self) -> usize {
        match self {
            Section::Status => 0,
            Section::Targets => 1,
            Section::Log => 2,
            Section::Gc => 3,
        }
    }

    pub fn from_index(i: usize) -> Option<Self> {
        match i {
            0 => Some(Section::Status),
            1 => Some(Section::Targets),
            2 => Some(Section::Log),
            3 => Some(Section::Gc),
            _ => None,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Section::Status => "Status",
            Section::Targets => "Targets",
            Section::Log => "Log",
            Section::Gc => "GC",
        }
    }
}

/// File search popup state for adding target directories.
#[derive(Debug, Clone, Default)]
pub struct FileSearchPopup {
    /// Base directory for search.
    pub base_dir: PathBuf,
    /// All files/dirs under base_dir.
    pub files: Vec<FileEntry>,
    /// Indices into `files` that match the current query.
    pub filtered_indices: Vec<usize>,
    /// Current search query.
    pub query: String,
    /// Selected index within filtered_indices.
    pub selected_index: usize,
}

#[derive(Debug, Clone)]
pub struct FileEntry {
    pub relative_path: String,
    pub is_dir: bool,
}

impl FileSearchPopup {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            files: Vec::new(),
            filtered_indices: Vec::new(),
            query: String::new(),
            selected_index: 0,
        }
    }

    /// Refresh the file list synchronously (walks up to 2000 entries).
    pub fn refresh_files_sync(&mut self) {
        self.files.clear();
        let base = self.base_dir.clone();
        self.collect_files(&base, &base);
        // Start with all files shown.
        self.filtered_indices = (0..self.files.len()).collect();
        self.selected_index = 0;
    }

    fn collect_files(&mut self, base: &PathBuf, dir: &PathBuf) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            if self.files.len() >= 2000 {
                return;
            }
            let path = entry.path();
            let is_dir = path.is_dir();
            if let Ok(rel) = path.strip_prefix(base) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                if rel.is_empty() {
                    continue;
                }
                self.files.push(FileEntry {
                    relative_path: rel,
                    is_dir,
                });
            }
            if is_dir {
                self.collect_files(base, &path);
            }
        }
    }

    pub fn update_query(&mut self, c: char) {
        self.query.push(c);
        self.apply_filter();
    }

    pub fn remove_char(&mut self) {
        self.query.pop();
        self.apply_filter();
    }

    fn apply_filter(&mut self) {
        let q = self.query.to_lowercase();
        self.filtered_indices = self
            .files
            .iter()
            .enumerate()
            .filter(|(_, f)| f.relative_path.to_lowercase().contains(&q))
            .map(|(i, _)| i)
            .collect();
        if self.selected_index >= self.filtered_indices.len() {
            self.selected_index = self.filtered_indices.len().saturating_sub(1);
        }
    }

    pub fn move_selection(&mut self, delta: isize) {
        if self.filtered_indices.is_empty() {
            return;
        }
        let len = self.filtered_indices.len() as isize;
        let new = (self.selected_index as isize + delta).rem_euclid(len);
        self.selected_index = new as usize;
    }

    pub fn selected_path(&self) -> Option<PathBuf> {
        self.filtered_indices
            .get(self.selected_index)
            .and_then(|&i| self.files.get(i))
            .map(|f| self.base_dir.join(&f.relative_path))
    }
}

/// Main application state.
pub struct App {
    /// Current section (tab).
    pub section: Section,
    /// Whether the sync engine is running.
    pub engine_running: bool,
    /// Whether a blocking operation is in progress.
    pub busy: bool,
    /// Cached status info from the last refresh.
    pub status: Option<peersync::status::StatusInfo>,
    /// Configured sync targets (label, target).
    pub targets: Vec<(String, peersync::config::TargetConfig)>,
    /// Cached log records.
    pub log: Vec<peersync::history::SyncRecord>,
    /// Doc ticket surfaced after engine start.
    pub ticket: Option<String>,
    /// Short-lived notification message.
    pub message: String,
    /// Selected list index in the current section.
    pub selected_index: usize,
    /// Whether the next GC run is dry-run.
    pub gc_dry_run: bool,
    /// Input buffer for adding a new sync target path.
    pub target_input: String,
    /// File search popup overlay (for adding targets).
    pub file_search: Option<FileSearchPopup>,
    /// Whether the link-ticket input is active (overlay on Status).
    pub link_mode: bool,
    /// Input buffer for the link ticket.
    pub link_input: String,
    /// Set when user presses ESC to cancel a link operation.
    pub link_cancelled: bool,
    /// Application quit flag.
    pub running: bool,
}

impl App {
    pub fn new() -> Self {
        Self {
            section: Section::Status,
            engine_running: false,
            busy: false,
            status: None,
            targets: Vec::new(),
            log: Vec::new(),
            ticket: None,
            message: String::new(),
            selected_index: 0,
            gc_dry_run: true,
            target_input: String::new(),
            file_search: None,
            link_mode: false,
            link_input: String::new(),
            link_cancelled: false,
            running: true,
        }
    }

    /// Load targets from a peersync config into the TUI state.
    pub fn load_targets(&mut self, config: &peersync::config::Config) {
        self.targets = config
            .targets
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
    }

    /// Number of selectable items in the current section.
    pub fn list_len(&self) -> usize {
        match self.section {
            Section::Status => self.status.as_ref().map_or(0, |s| {
                s.online_peers.len() + s.targets.len() + s.conflict_files.len()
            }),
            Section::Targets => self.targets.len(),
            Section::Log => self.log.len(),
            Section::Gc => 0,
        }
    }

    /// Add a path as a new sync target (with dedup and unique key generation).
    pub fn add_target(&mut self, path: &str) {
        let expanded = peersync::config::expand_path(path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string());

        if self.targets.iter().any(|(_, t)| t.src == expanded) {
            self.message = format!("Already a target: {}", path);
            return;
        }

        let base_key = std::path::Path::new(&expanded)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("target")
            .to_string();
        let mut key = base_key.clone();
        let mut suffix = 1;
        while self.targets.iter().any(|(k, _)| *k == key) {
            key = format!("{}-{}", base_key, suffix);
            suffix += 1;
        }
        let target = peersync::config::TargetConfig {
            src: expanded,
            ignore: Vec::new(),
        };
        self.targets.push((key, target));
        if self.save_targets_to_disk().is_err() {
            self.message = "Failed to save config".to_string();
        } else {
            self.message = format!("Added target: {}", path);
        }
    }

    /// Remove the currently selected target from the list and persist.
    pub fn remove_target(&mut self) {
        if self.section != Section::Targets || self.targets.is_empty() {
            return;
        }
        if self.selected_index < self.targets.len() {
            let removed = self.targets.remove(self.selected_index);
            if self.selected_index >= self.targets.len() && !self.targets.is_empty() {
                self.selected_index = self.targets.len() - 1;
            }
            if self.save_targets_to_disk().is_err() {
                self.message = "Failed to save config".to_string();
            } else {
                self.message = format!("Removed target: {}", removed.0);
            }
        }
    }

    /// Persist current targets to the peersync config on disk.
    fn save_targets_to_disk(&self) -> anyhow::Result<()> {
        let config_dir = config_dir();
        let mut config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
        config.targets.clear();
        for (key, target) in &self.targets {
            config.targets.insert(key.clone(), target.clone());
        }
        peersync::config::save_config(Some(&config_dir), &config)?;
        Ok(())
    }

    /// Open file search popup.
    pub fn open_file_search(&mut self) {
        let base_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut popup = FileSearchPopup::new(base_dir);
        popup.refresh_files_sync();
        self.file_search = Some(popup);
    }

    /// Close file search popup.
    pub fn close_file_search(&mut self) {
        self.file_search = None;
    }

    /// Handle a key event.
    pub fn handle_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;

        // File search popup takes priority.
        if self.file_search.is_some() {
            self.handle_file_search_key(key);
            return;
        }

        // Link input mode takes priority.
        if self.link_mode {
            self.handle_link_key(key);
            return;
        }

        match key.code {
            KeyCode::Char('s') | KeyCode::Char('S') => {
                self.section = Section::Status;
                self.selected_index = 0;
            }
            KeyCode::Char('t') | KeyCode::Char('T') => {
                self.section = Section::Targets;
                self.selected_index = 0;
            }
            KeyCode::Char('l') | KeyCode::Char('L') => {
                self.section = Section::Log;
                self.selected_index = 0;
            }
            KeyCode::Char('g') | KeyCode::Char('G') => {
                self.section = Section::Gc;
                self.selected_index = 0;
            }
            KeyCode::Char('r') | KeyCode::Char('R') => {
                // Refresh — handled by the event loop.
            }
            KeyCode::Char('c') | KeyCode::Char('C') => {
                if self.section == Section::Status {
                    self.message = "Clipboard copy not yet implemented in this TUI".to_string();
                }
            }
            KeyCode::Char('o') | KeyCode::Char('O') => {
                if self.section == Section::Status {
                    self.link_mode = true;
                    self.link_input.clear();
                    self.link_cancelled = false;
                }
            }
            KeyCode::Char('d') | KeyCode::Char('D') => {
                if self.section == Section::Gc {
                    self.gc_dry_run = !self.gc_dry_run;
                } else if self.section == Section::Targets {
                    self.remove_target();
                }
            }
            KeyCode::Up => {
                if self.selected_index > 0 {
                    self.selected_index -= 1;
                }
            }
            KeyCode::Down => {
                let max = self.list_len();
                if self.selected_index + 1 < max {
                    self.selected_index += 1;
                }
            }
            _ => {
                // Targets section accepts typed paths.
                if self.section == Section::Targets {
                    self.handle_target_input_key(key);
                }
            }
        }
    }

    /// Handle key events while the link input is active.
    fn handle_link_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        match key.code {
            KeyCode::Char(c) => self.link_input.push(c),
            KeyCode::Backspace => {
                self.link_input.pop();
            }
            KeyCode::Esc => {
                self.link_mode = false;
                self.link_input.clear();
                self.link_cancelled = true;
                self.busy = false;
            }
            _ => {}
        }
    }

    /// Handle key events in the file search popup.
    fn handle_file_search_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        let Some(popup) = &mut self.file_search else {
            return;
        };

        match key.code {
            KeyCode::Char(c) => popup.update_query(c),
            KeyCode::Backspace => popup.remove_char(),
            KeyCode::Up => popup.move_selection(-1),
            KeyCode::Down => popup.move_selection(1),
            KeyCode::Enter => {
                if let Some(path) = popup.selected_path() {
                    self.add_target(path.to_string_lossy().as_ref());
                }
                self.close_file_search();
            }
            KeyCode::Esc => self.close_file_search(),
            _ => {}
        }
    }

    /// Handle key events in the target path input.
    fn handle_target_input_key(&mut self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        match key.code {
            KeyCode::Char('@') => self.open_file_search(),
            KeyCode::Char(c) => self.target_input.push(c),
            KeyCode::Backspace => {
                self.target_input.pop();
            }
            _ => {}
        }
    }

    /// Handle bracketed paste.
    pub fn handle_paste(&mut self, text: &str) {
        let cleaned: String = text
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect();
        let cleaned = cleaned.trim().to_string();
        if cleaned.is_empty() {
            return;
        }
        if self.link_mode {
            self.link_input.push_str(&cleaned);
        } else if self.section == Section::Targets {
            self.target_input.push_str(&cleaned);
        }
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

/// Default config dir used by the TUI.
pub fn config_dir() -> PathBuf {
    std::env::var("PEERSYNC_CONFIG_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("sendme")
                .join("peersync")
        })
}

/// Default data dir used by the TUI.
pub fn data_dir() -> PathBuf {
    std::env::var("PEERSYNC_DATA_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("sendme")
                .join("peersync")
        })
}

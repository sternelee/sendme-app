//! Cloud tab rendering: WebSocket status, devices, friends, and incoming tickets.

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::tui::{
    app::{CloudSection, CloudWsState},
    App,
};

pub fn render_cloud_tab(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Status bar
            Constraint::Length(3), // Section tabs
            Constraint::Min(0),    // Content
        ])
        .split(area);

    render_ws_status(f, app, chunks[0]);
    render_section_tabs(f, app, chunks[1]);

    match app.cloud_section {
        CloudSection::Devices => render_devices_section(f, app, chunks[2]),
        CloudSection::Friends => render_friends_section(f, app, chunks[2]),
        CloudSection::Incoming => render_incoming_section(f, app, chunks[2]),
    }
}

fn render_ws_status(f: &mut Frame, app: &App, area: Rect) {
    let (status_text, status_color) = match app.cloud_ws_state {
        CloudWsState::NotLoggedIn => (
            " ✗ Not logged in – set api_key in ~/.config/sendme/config.toml".to_string(),
            Color::DarkGray,
        ),
        CloudWsState::Connecting => (" ◌ Connecting to cloud…".to_string(), Color::Yellow),
        CloudWsState::Connected => (" ● Connected".to_string(), Color::Green),
        CloudWsState::Reconnecting => {
            (" ↻ Reconnecting to cloud…".to_string(), Color::Yellow)
        }
    };

    let device_info = if let Some(id) = &app.cloud_my_device_db_id {
        format!("  Device ID: {}", &id[..id.len().min(12)])
    } else {
        String::new()
    };

    let notification = app
        .cloud_notification
        .as_deref()
        .map(|n| format!("  │  {n}"))
        .unwrap_or_default();

    let line = Line::from(vec![
        Span::styled(status_text, Style::default().fg(status_color).add_modifier(Modifier::BOLD)),
        Span::raw(device_info),
        Span::styled(notification, Style::default().fg(Color::Cyan)),
    ]);

    let para = Paragraph::new(line)
        .block(Block::default().borders(Borders::ALL).title(" Cloud "));
    f.render_widget(para, area);
}

fn render_section_tabs(f: &mut Frame, app: &App, area: Rect) {
    let tabs_line = Line::from(vec![
        section_span("Devices", app.cloud_section == CloudSection::Devices),
        Span::raw("  "),
        section_span("Friends", app.cloud_section == CloudSection::Friends),
        Span::raw("  "),
        section_span("Incoming", app.cloud_section == CloudSection::Incoming),
    ]);
    let para = Paragraph::new(tabs_line)
        .block(Block::default().borders(Borders::NONE));
    f.render_widget(para, area);
}

fn section_span(label: &str, active: bool) -> Span<'static> {
    if active {
        Span::styled(
            format!("[{}]", label),
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
        )
    } else {
        Span::styled(
            format!(" {} ", label),
            Style::default().fg(Color::DarkGray),
        )
    }
}

fn render_devices_section(f: &mut Frame, app: &App, area: Rect) {
    if app.cloud_devices.is_empty() {
        let msg = if matches!(app.cloud_ws_state, CloudWsState::NotLoggedIn) {
            "Log in to see your devices."
        } else {
            "No other devices registered."
        };
        let para = Paragraph::new(msg)
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::ALL).title(" My Devices "));
        f.render_widget(para, area);
        return;
    }

    let items: Vec<ListItem> = app
        .cloud_devices
        .iter()
        .map(|d| {
            ListItem::new(format!("  {}  (id: {})", d.name, &d.id[..d.id.len().min(12)]))
        })
        .collect();

    let mut state = ListState::default();
    if app.cloud_section == CloudSection::Devices {
        state.select(Some(app.cloud_selected_index));
    }

    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" My Devices "))
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut state);
}

fn render_friends_section(f: &mut Frame, app: &App, area: Rect) {
    if app.cloud_friends.is_empty() {
        let msg = if matches!(app.cloud_ws_state, CloudWsState::NotLoggedIn) {
            "Log in to see your friends."
        } else {
            "No friends added yet."
        };
        let para = Paragraph::new(msg)
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::ALL).title(" Friends "));
        f.render_widget(para, area);
        return;
    }

    let items: Vec<ListItem> = app
        .cloud_friends
        .iter()
        .map(|f_entry| {
            let name = f_entry
                .friend
                .as_ref()
                .map(|fi| fi.name.as_str())
                .unwrap_or("(unknown)");
            let device_count = f_entry.friend_devices.len();
            let dev_label = if device_count == 1 { "device" } else { "devices" };
            ListItem::new(format!("  {}  ({} {})", name, device_count, dev_label))
        })
        .collect();

    let mut state = ListState::default();
    if app.cloud_section == CloudSection::Friends {
        state.select(Some(app.cloud_selected_index));
    }

    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" Friends "))
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut state);
}

fn render_incoming_section(f: &mut Frame, app: &App, area: Rect) {
    if app.cloud_pending_tickets.is_empty() {
        let msg = if matches!(app.cloud_ws_state, CloudWsState::NotLoggedIn) {
            "Log in to receive files from friends."
        } else {
            "No incoming files."
        };
        let para = Paragraph::new(msg)
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::ALL).title(" Incoming Files "));
        f.render_widget(para, area);
        return;
    }

    let items: Vec<ListItem> = app
        .cloud_pending_tickets
        .iter()
        .map(|t| {
            let name = t.filename.as_deref().unwrap_or("(unknown)");
            let size = t
                .file_size
                .map(|s| format!("  {}", human_size(s as u64)))
                .unwrap_or_default();
            ListItem::new(format!("  {} {}", name, size))
        })
        .collect();

    let mut state = ListState::default();
    if app.cloud_section == CloudSection::Incoming {
        state.select(Some(app.cloud_selected_index));
    }

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Incoming Files  [Enter] Receive "),
        )
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut state);
}

fn human_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

//! PeerSync tab rendering.

use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap},
    Frame,
};

use crate::tui::app::{App, PeerSyncSection};

/// Render the PeerSync tab.
pub fn render_peer_sync_tab(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(4), // status / engine control + message
            Constraint::Length(3), // section tabs
            Constraint::Min(0),    // content
        ])
        .split(area);

    render_engine_status(f, app, chunks[0]);
    render_section_tabs(f, app, chunks[1]);

    match app.peer_sync_section {
        PeerSyncSection::Status => render_status_section(f, app, chunks[2]),
        PeerSyncSection::Targets => render_targets_section(f, app, chunks[2]),
        PeerSyncSection::Log => render_log_section(f, app, chunks[2]),
        PeerSyncSection::Gc => render_gc_section(f, app, chunks[2]),
    }

    // Render file search popup on top if active.
    if app.peer_sync_file_search.is_some() {
        render_file_search_popup(f, app, area);
    }
}

fn render_engine_status(f: &mut Frame, app: &App, area: Rect) {
    let status_text = if app.peer_sync_engine_running {
        " ● Engine running ".to_string()
    } else {
        " ○ Engine stopped ".to_string()
    };
    let status_color = if app.peer_sync_engine_running {
        Color::Green
    } else {
        Color::DarkGray
    };

    let action_hint = if app.peer_sync_engine_running {
        "[Enter] Stop sync"
    } else {
        "[Enter] Start sync"
    };

    let busy_hint = if app.peer_sync_busy {
        "  (working…)"
    } else {
        ""
    };

    let mut lines = vec![Line::from(vec![
        Span::styled(
            status_text,
            Style::default()
                .fg(status_color)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(format!(
            "  {}  {}{}",
            action_hint,
            section_hint(),
            busy_hint
        )),
    ])];

    // Surface transient messages (warnings, progress, results) in the header
    // so they are visible regardless of which section is selected.
    if !app.peer_sync_message.is_empty() {
        lines.push(Line::from(vec![Span::styled(
            format!("  {}", app.peer_sync_message),
            Style::default().fg(Color::Yellow),
        )]));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .title(" PeerSync ")
        .border_style(Style::default().fg(Color::DarkGray));

    let para = Paragraph::new(lines).block(block);
    f.render_widget(para, area);
}

fn section_hint() -> &'static str {
    "[s] Status | [t] Targets | [l] Log | [g] GC | [r] Refresh"
}

fn render_section_tabs(f: &mut Frame, app: &App, area: Rect) {
    let tabs_line = Line::from(vec![
        section_span("Status", app.peer_sync_section == PeerSyncSection::Status),
        Span::raw("  "),
        section_span("Targets", app.peer_sync_section == PeerSyncSection::Targets),
        Span::raw("  "),
        section_span("Log", app.peer_sync_section == PeerSyncSection::Log),
        Span::raw("  "),
        section_span("GC", app.peer_sync_section == PeerSyncSection::Gc),
    ]);
    let para = Paragraph::new(tabs_line).block(Block::default().borders(Borders::NONE));
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
        Span::styled(format!(" {} ", label), Style::default().fg(Color::DarkGray))
    }
}

fn render_status_section(f: &mut Frame, app: &App, area: Rect) {
    let chunks = if app.peer_sync_link_mode {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(0), Constraint::Length(5)])
            .split(area)
    } else {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(100)])
            .split(area)
    };

    let content_area = chunks[0];

    let Some(info) = &app.peer_sync_status else {
        let para = Paragraph::new("Press [r] to refresh status.")
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::ALL).title(" Status "));
        f.render_widget(para, content_area);
        if app.peer_sync_link_mode {
            render_link_input(f, app, chunks[1]);
        }
        return;
    };

    let mut lines = Vec::new();
    lines.push(Line::from(vec![
        Span::styled("Device: ", Style::default().fg(Color::Cyan)),
        Span::raw(&info.device_name),
    ]));
    lines.push(Line::from(vec![
        Span::styled("Namespace: ", Style::default().fg(Color::Cyan)),
        Span::raw(info.namespace_id.as_deref().unwrap_or("(none)")),
    ]));
    lines.push(Line::from(vec![
        Span::styled("Author: ", Style::default().fg(Color::Cyan)),
        Span::raw(info.author_id.as_deref().unwrap_or("(none)")),
    ]));

    lines.push(Line::from(vec![
        Span::styled("Ticket: ", Style::default().fg(Color::Cyan)),
        Span::raw(
            app.peer_sync_ticket
                .as_deref()
                .unwrap_or("(start engine to generate)"),
        ),
    ]));

    lines.push(Line::from(""));
    lines.push(Line::from(vec![Span::styled(
        "Peers",
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
    )]));
    if info.online_peers.is_empty() {
        lines.push(Line::from("  (none seen yet)"));
    } else {
        for p in &info.online_peers {
            let label = if p.online { "online" } else { "offline" };
            lines.push(Line::from(format!(
                "  {} [{}]",
                &p.node_id[..p.node_id.len().min(16)],
                label
            )));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(vec![Span::styled(
        "Targets",
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
    )]));
    for t in &info.targets {
        let conflict = if t.has_conflicts {
            " ⚠ conflicts"
        } else {
            ""
        };
        lines.push(Line::from(format!(
            "  {} -> {} ({} files){}",
            t.key, t.src, t.file_count, conflict
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(vec![Span::styled(
        "Recent events",
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
    )]));
    if info.recent_events.is_empty() {
        lines.push(Line::from("  (none)"));
    } else {
        for e in &info.recent_events {
            lines.push(Line::from(format!(
                "  [{}] {} {}/{}",
                e.timestamp_ms, e.action, e.target_key, e.relative_path
            )));
        }
    }

    let para = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Status "))
        .alignment(Alignment::Left);
    f.render_widget(para, content_area);

    if app.peer_sync_link_mode {
        render_link_input(f, app, chunks[1]);
    }
}

fn render_link_input(f: &mut Frame, app: &App, area: Rect) {
    let text = if app.peer_sync_link_input.is_empty() {
        vec![Line::from(Span::styled(
            "Paste the ticket from the host device and press Enter…",
            Style::default().fg(Color::DarkGray),
        ))]
    } else {
        vec![Line::from(Span::styled(
            format!("> {}", app.peer_sync_link_input),
            Style::default().fg(Color::White),
        ))]
    };
    let para = Paragraph::new(text)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan))
                .title(" Link to existing sync doc "),
        )
        .wrap(Wrap { trim: true });
    f.render_widget(para, area);
}

fn render_log_section(f: &mut Frame, app: &App, area: Rect) {
    if app.peer_sync_log.is_empty() {
        let para = Paragraph::new("Press [r] to refresh log.")
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::ALL).title(" Log "));
        f.render_widget(para, area);
        return;
    }

    let items: Vec<ListItem> = app
        .peer_sync_log
        .iter()
        .map(|r| {
            let mut text = format!(
                "[{}] {:20} {}/{}",
                r.timestamp_ms,
                r.action.as_str(),
                r.target_key,
                r.relative_path
            );
            if let Some(hash) = &r.file_hash {
                text.push_str(&format!("  hash: {}", hash));
            }
            ListItem::new(Line::from(text))
        })
        .collect();

    let mut state = ListState::default();
    if app.peer_sync_section == PeerSyncSection::Log {
        state.select(Some(app.peer_sync_selected_index));
    }

    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" Log "))
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut state);
}

fn render_gc_section(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = Vec::new();
    lines.push(Line::from(vec![
        Span::styled("GC actions", Style::default().fg(Color::Yellow)),
        Span::raw("  [Enter] Run GC   [d] Dry-run"),
    ]));
    lines.push(Line::from(""));

    if app.peer_sync_message.is_empty() {
        lines.push(Line::from(
            "Select an action to clean up old conflict backups and history records.",
        ));
    } else {
        lines.push(Line::from(vec![Span::styled(
            &app.peer_sync_message,
            Style::default().fg(Color::Green),
        )]));
    }

    let para = Paragraph::new(lines)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Garbage Collection "),
        )
        .alignment(Alignment::Left);
    f.render_widget(para, area);
}

fn render_targets_section(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(0),
            Constraint::Length(6),
        ])
        .split(area);

    // Input line
    let input_text = if app.peer_sync_target_input.is_empty() {
        vec![Line::from(Span::styled(
            "Type or paste a path, or press [@] to search… (terminal paste / OS drag-drop supported)",
            Style::default().fg(Color::DarkGray),
        ))]
    } else {
        vec![Line::from(Span::styled(
            format!("> {}", app.peer_sync_target_input),
            Style::default().fg(Color::White),
        ))]
    };
    let input = Paragraph::new(input_text)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Add target path "),
        )
        .wrap(Wrap { trim: true });
    f.render_widget(input, chunks[0]);

    // Target list
    let items: Vec<ListItem> = app
        .peer_sync_targets
        .iter()
        .enumerate()
        .map(|(idx, (key, target))| {
            let icon = if std::path::Path::new(&target.src).is_dir() {
                "📁 "
            } else {
                "📄 "
            };
            ListItem::new(Line::from(format!(
                "{} {}{}: {}",
                if app.peer_sync_selected_index == idx {
                    "▶"
                } else {
                    " "
                },
                icon,
                key,
                target.src
            )))
        })
        .collect();

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Sync targets "),
        )
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        );

    let mut state = ListState::default();
    if app.peer_sync_section == crate::tui::app::PeerSyncSection::Targets {
        state.select(Some(app.peer_sync_selected_index));
    }
    f.render_stateful_widget(list, chunks[1], &mut state);

    // Help
    let help = Paragraph::new(vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("[@]", Style::default().fg(Color::Cyan)),
            Span::raw(" file search  "),
            Span::styled("[Enter]", Style::default().fg(Color::Cyan)),
            Span::raw(" add path  "),
            Span::styled("[d]", Style::default().fg(Color::Cyan)),
            Span::raw(" remove selected  "),
            Span::styled("[↑↓]", Style::default().fg(Color::Cyan)),
            Span::raw(" navigate"),
        ]),
    ])
    .block(Block::default().borders(Borders::NONE));
    f.render_widget(help, chunks[2]);
}

/// Render the file search popup overlay.
fn render_file_search_popup(f: &mut Frame, app: &App, area: Rect) {
    let Some(popup) = &app.peer_sync_file_search else {
        return;
    };

    let popup_width = area.width * 80 / 100;
    let popup_height = area.height * 60 / 100;
    let popup_area = Rect {
        x: area.x + (area.width - popup_width) / 2,
        y: area.y + (area.height - popup_height) / 2,
        width: popup_width,
        height: popup_height,
    };

    f.render_widget(Clear, popup_area);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0)].as_ref())
        .margin(1)
        .split(popup_area);

    let input_text = if popup.query.is_empty() {
        vec![Line::from(Span::styled(
            "Type to search files and directories…",
            Style::default().fg(Color::DarkGray),
        ))]
    } else {
        vec![Line::from(Span::styled(
            format!("> {}", popup.query),
            Style::default().fg(Color::White),
        ))]
    };
    let input = Paragraph::new(input_text)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan))
                .title(" File Search "),
        )
        .wrap(Wrap { trim: true });
    f.render_widget(input, chunks[0]);

    let items: Vec<ListItem> = popup
        .filtered_indices
        .iter()
        .filter_map(|&idx| popup.files.get(idx))
        .map(|file| {
            let icon = if file.is_dir { "📁 " } else { "📄 " };
            ListItem::new(Line::from(format!("{}{}", icon, file.relative_path)))
        })
        .collect();

    let title = format!(
        " Results ({}) ",
        popup.filtered_indices.len().min(popup.files.len())
    );
    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Blue))
                .title(title),
        )
        .highlight_style(
            Style::default()
                .fg(Color::Black)
                .bg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol(">> ");

    let mut state = ListState::default();
    if !popup.filtered_indices.is_empty() {
        state.select(Some(popup.selected_index));
    }
    f.render_stateful_widget(list, chunks[1], &mut state);
}

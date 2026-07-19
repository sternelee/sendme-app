//! UI rendering for the PeerSync TUI.

use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Tabs, Wrap},
    Frame, Terminal,
};

use crate::tui::app::{App, Section};

/// Render a full frame.
pub fn render(
    terminal: &mut Terminal<impl ratatui::backend::Backend>,
    app: &App,
) -> std::io::Result<()> {
    terminal.draw(|f| {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3), // header
                Constraint::Length(3), // section tabs
                Constraint::Min(0),    // content
                Constraint::Length(1), // footer
            ])
            .split(f.area());

        render_header(f, app, chunks[0]);
        render_section_tabs(f, app, chunks[1]);

        match app.section {
            Section::Status => render_status_section(f, app, chunks[2]),
            Section::Targets => render_targets_section(f, app, chunks[2]),
            Section::Log => render_log_section(f, app, chunks[2]),
            Section::Gc => render_gc_section(f, app, chunks[2]),
        }

        render_footer(f, app, chunks[3]);

        // File search popup on top.
        if app.file_search.is_some() {
            render_file_search_popup(f, app, f.area());
        }
    })?;
    Ok(())
}

// ----- Header -----

fn render_header(f: &mut Frame, app: &App, area: Rect) {
    let status_text = if app.engine_running {
        " ● Engine running "
    } else {
        " ○ Engine stopped "
    };
    let status_color = if app.engine_running {
        Color::Green
    } else {
        Color::DarkGray
    };

    let action_hint = if app.engine_running {
        "[Enter] Stop"
    } else {
        "[Enter] Start"
    };

    let busy = if app.busy { "  (working…)" } else { "" };

    let mut lines = vec![Line::from(vec![
        Span::styled(
            status_text,
            Style::default()
                .fg(status_color)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(format!("  {}{}", action_hint, busy)),
    ])];

    if !app.message.is_empty() {
        lines.push(Line::from(vec![Span::styled(
            format!("  {}", app.message),
            Style::default().fg(Color::Yellow),
        )]));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .title(" PeerSync ")
        .border_style(Style::default().fg(Color::DarkGray));
    f.render_widget(Paragraph::new(lines).block(block), area);
}

// ----- Section tabs -----

fn render_section_tabs(f: &mut Frame, app: &App, area: Rect) {
    let tabs: Vec<Line> = Section::all()
        .iter()
        .map(|sec| {
            let style = if *sec == app.section {
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD | Modifier::UNDERLINED)
            } else {
                Style::default().fg(Color::DarkGray)
            };
            Line::from(Span::styled(format!("[{}]", sec.name()), style))
        })
        .collect();

    let tabs = Tabs::new(tabs)
        .block(Block::default().borders(Borders::NONE))
        .style(Style::default().fg(Color::White))
        .highlight_style(
            Style::default()
                .bg(Color::Blue)
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        )
        .divider(Span::raw("  "))
        .select(app.section.index());

    f.render_widget(tabs, area);
}

// ----- Status section -----

fn render_status_section(f: &mut Frame, app: &App, area: Rect) {
    let chunks = if app.link_mode {
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

    let Some(info) = &app.status else {
        let para = Paragraph::new("Press [r] to refresh status.")
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::ALL).title(" Status "));
        f.render_widget(para, content_area);
        if app.link_mode {
            render_link_input(f, app, chunks[1]);
        }
        return;
    };

    let mut lines = Vec::new();
    // Device info
    lines.push(key_value_line("Device:", &info.device_name, Color::Cyan));
    lines.push(key_value_line(
        "Namespace:",
        info.namespace_id.as_deref().unwrap_or("(none)"),
        Color::Cyan,
    ));
    lines.push(key_value_line(
        "Author:",
        info.author_id.as_deref().unwrap_or("(none)"),
        Color::Cyan,
    ));
    lines.push(key_value_line(
        "Ticket:",
        app.ticket
            .as_deref()
            .unwrap_or("(start engine to generate)"),
        Color::Cyan,
    ));

    // Peers
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

    // Targets overview
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
            "  {} → {} ({} files){}",
            t.key, t.src, t.file_count, conflict
        )));
    }

    // Recent events
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

    if app.link_mode {
        render_link_input(f, app, chunks[1]);
    }
}

fn key_value_line<'a>(key: &'a str, value: &'a str, color: Color) -> Line<'a> {
    Line::from(vec![
        Span::styled(key, Style::default().fg(color)),
        Span::raw(" "),
        Span::raw(value),
    ])
}

fn render_link_input(f: &mut Frame, app: &App, area: Rect) {
    let text = if app.link_input.is_empty() {
        vec![Line::from(Span::styled(
            "Paste the ticket from the host device and press Enter…",
            Style::default().fg(Color::DarkGray),
        ))]
    } else {
        vec![Line::from(Span::styled(
            format!("> {}", app.link_input),
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

// ----- Targets section -----

fn render_targets_section(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // input
            Constraint::Min(0),    // list
            Constraint::Length(6), // help
        ])
        .split(area);

    // Input line
    let input_text = if app.target_input.is_empty() {
        vec![Line::from(Span::styled(
            "Type or paste a path, or press [@] to search…",
            Style::default().fg(Color::DarkGray),
        ))]
    } else {
        vec![Line::from(Span::styled(
            format!("> {}", app.target_input),
            Style::default().fg(Color::White),
        ))]
    };
    f.render_widget(
        Paragraph::new(input_text)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" Add target path "),
            )
            .wrap(Wrap { trim: true }),
        chunks[0],
    );

    // Target list
    let items: Vec<ListItem> = app
        .targets
        .iter()
        .enumerate()
        .map(|(idx, (key, target))| {
            let icon = if std::path::Path::new(&target.src).is_dir() {
                "📁 "
            } else {
                "📄 "
            };
            ListItem::new(Line::from(format!(
                "{}{}{}: {}",
                if app.selected_index == idx {
                    "▶ "
                } else {
                    "  "
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
        )
        .highlight_symbol("▶ ");
    let mut state = ListState::default();
    state.select(Some(app.selected_index));
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

// ----- Log section -----

fn render_log_section(f: &mut Frame, app: &App, area: Rect) {
    if app.log.is_empty() {
        let para = Paragraph::new("Press [r] to refresh log.")
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::ALL).title(" Log "));
        f.render_widget(para, area);
        return;
    }

    let items: Vec<ListItem> = app
        .log
        .iter()
        .enumerate()
        .map(|(idx, r)| {
            let prefix = if app.selected_index == idx {
                "▶ "
            } else {
                "  "
            };
            ListItem::new(Line::from(format!(
                "{}[{}] {:20} {}/{}",
                prefix,
                r.timestamp_ms,
                r.action.as_str(),
                r.target_key,
                r.relative_path
            )))
        })
        .collect();

    let mut state = ListState::default();
    state.select(Some(app.selected_index));

    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" Log "))
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        );
    f.render_stateful_widget(list, area, &mut state);
}

// ----- GC section -----

fn render_gc_section(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = Vec::new();
    let dry_run_label = if app.gc_dry_run { "ON" } else { "OFF" };
    let dry_run_color = if app.gc_dry_run {
        Color::Yellow
    } else {
        Color::DarkGray
    };
    lines.push(Line::from(vec![
        Span::styled(
            "GC actions",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("  [Enter] Run GC   [d] Dry-run: "),
        Span::styled(
            dry_run_label,
            Style::default()
                .fg(dry_run_color)
                .add_modifier(Modifier::BOLD),
        ),
    ]));
    lines.push(Line::from(""));

    if app.message.is_empty() {
        let mode_hint = if app.gc_dry_run {
            "Dry-run mode: no files will be deleted. Toggle with [d]."
        } else {
            "Live mode: files WILL be deleted. Toggle dry-run with [d]."
        };
        lines.push(Line::from(mode_hint));
        lines.push(Line::from(
            "Select an action to clean up old conflict backups and history records.",
        ));
    } else {
        lines.push(Line::from(vec![Span::styled(
            &app.message,
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

// ----- File search popup -----

fn render_file_search_popup(f: &mut Frame, app: &App, area: Rect) {
    let Some(popup) = &app.file_search else {
        return;
    };

    let popup_width = (area.width * 80 / 100).max(40);
    let popup_height = (area.height * 60 / 100).max(10);
    let popup_area = Rect {
        x: area.x + (area.width - popup_width) / 2,
        y: area.y + (area.height - popup_height) / 2,
        width: popup_width,
        height: popup_height,
    };

    f.render_widget(Clear, popup_area);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0)])
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
    f.render_widget(
        Paragraph::new(input_text)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Cyan))
                    .title(" File Search "),
            )
            .wrap(Wrap { trim: true }),
        chunks[0],
    );

    let items: Vec<ListItem> = popup
        .filtered_indices
        .iter()
        .filter_map(|&idx| popup.files.get(idx))
        .map(|file| {
            let icon = if file.is_dir { "📁 " } else { "📄 " };
            ListItem::new(Line::from(format!("{}{}", icon, file.relative_path)))
        })
        .collect();

    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Blue))
                .title(format!(" Results ({}) ", popup.filtered_indices.len())),
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

// ----- Footer -----

fn render_footer(f: &mut Frame, app: &App, section: Rect) {
    let help = format!(
        " [s/t/l/g] Section | [q] Quit | [r] Refresh | [o] Link | [Enter] {}",
        if app.engine_running {
            "Stop engine"
        } else {
            "Start engine"
        }
    );
    f.render_widget(
        Paragraph::new(help)
            .style(Style::default().fg(Color::DarkGray))
            .alignment(Alignment::Center),
        section,
    );
}

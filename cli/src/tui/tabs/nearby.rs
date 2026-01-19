//! Nearby tab rendering.

use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table},
    Frame,
};

use crate::tui::App;

/// Render the nearby tab.
pub fn render_nearby_tab(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(
            [
                Constraint::Length(3), // Title
                Constraint::Length(3), // Ticket info
                Constraint::Min(0),    // Device list
                Constraint::Length(2), // Help text
            ]
            .as_ref(),
        )
        .margin(1)
        .split(area);

    // Title and description
    let title = Paragraph::new(vec![
        Line::from(Span::styled(
            "Nearby Devices",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![Span::styled(
            format!(
                "{} device(s) found - Discovery: {}",
                app.nearby_devices.len(),
                if app.nearby_enabled { "ON" } else { "OFF" }
            ),
            Style::default().fg(Color::Gray),
        )]),
    ])
    .alignment(Alignment::Center);

    f.render_widget(title, chunks[0]);

    // Ticket info section
    let ticket_info = if let Some(ticket) = &app.send_success_ticket {
        let short_ticket = if ticket.len() > 40 {
            format!("{}...", &ticket[..40])
        } else {
            ticket.clone()
        };
        Paragraph::new(vec![Line::from(vec![
            Span::styled("Current Ticket: ", Style::default().fg(Color::Yellow)),
            Span::styled(short_ticket, Style::default().fg(Color::Green)),
        ])])
        .alignment(Alignment::Center)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Yellow)),
        )
    } else {
        Paragraph::new(vec![Line::from(vec![Span::styled(
            "No ticket available. Send a file first (Tab 1).",
            Style::default().fg(Color::DarkGray),
        )])])
        .alignment(Alignment::Center)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
    };

    f.render_widget(ticket_info, chunks[1]);

    // Devices list
    if app.nearby_devices.is_empty() {
        let empty = Paragraph::new(vec![
            Line::from(""),
            Line::from(vec![Span::styled(
                if app.nearby_enabled {
                    "Scanning for nearby devices..."
                } else {
                    "Discovery is disabled"
                },
                Style::default().fg(Color::DarkGray),
            )]),
            Line::from(""),
            Line::from("Press [s] to start/stop discovery."),
        ])
        .alignment(Alignment::Center);

        f.render_widget(empty, chunks[2]);
    } else {
        let header_cells = vec!["Device Name", "Status", "Address", "Last Seen"];
        let header = Row::new(header_cells.iter().map(|h| {
            Cell::from(*h).style(
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )
        }))
        .height(1)
        .bottom_margin(1);

        let rows: Vec<Row> = app
            .nearby_devices
            .iter()
            .enumerate()
            .map(|(idx, device)| {
                let is_selected = app.selected_nearby_device_index == Some(idx);
                let name = device.alias.clone();

                let status_style = if device.available {
                    Style::default().fg(Color::Green)
                } else {
                    Style::default().fg(Color::DarkGray)
                };

                let status = if device.available {
                    "Online"
                } else {
                    "Offline"
                };

                let addr = if device.ip.is_empty() {
                    "N/A".to_string()
                } else {
                    format!("{}:{}", device.ip, device.port)
                };

                let last_seen = format_time(device.last_seen);

                let row_style = if is_selected {
                    Style::default()
                        .bg(Color::Blue)
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                };

                Row::new(vec![
                    Cell::from(if is_selected {
                        format!("▶ {}", name)
                    } else {
                        format!("  {}", name)
                    }),
                    Cell::from(status).style(if is_selected { row_style } else { status_style }),
                    Cell::from(addr),
                    Cell::from(last_seen),
                ])
                .style(row_style)
                .height(1)
            })
            .collect();

        let table = Table::new(
            rows,
            [
                Constraint::Percentage(30),
                Constraint::Percentage(15),
                Constraint::Percentage(35),
                Constraint::Percentage(20),
            ],
        )
        .header(header)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray))
                .title(if app.nearby_message.is_empty() {
                    " Devices "
                } else {
                    ""
                }),
        );

        f.render_widget(table, chunks[2]);
    }

    // Help text and message
    let help_text = if !app.nearby_message.is_empty() {
        Paragraph::new(Line::from(vec![Span::styled(
            &app.nearby_message,
            Style::default().fg(Color::Yellow),
        )]))
    } else {
        Paragraph::new(Line::from(vec![
            Span::styled("[s]", Style::default().fg(Color::Cyan)),
            Span::raw(" toggle discovery  "),
            Span::styled("[↑/↓]", Style::default().fg(Color::Cyan)),
            Span::raw(" select device  "),
            Span::styled("[Enter]", Style::default().fg(Color::Cyan)),
            Span::raw(" send ticket"),
        ]))
    }
    .alignment(Alignment::Center);

    f.render_widget(help_text, chunks[3]);
}

/// Format timestamp to human readable time.
fn format_time(timestamp: i64) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let elapsed = now - timestamp;

    if elapsed < 60 {
        format!("{}s ago", elapsed)
    } else if elapsed < 3600 {
        format!("{}m ago", elapsed / 60)
    } else if elapsed < 86400 {
        format!("{}h ago", elapsed / 3600)
    } else {
        format!("{}d ago", elapsed / 86400)
    }
}

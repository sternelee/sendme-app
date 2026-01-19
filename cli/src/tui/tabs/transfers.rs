//! Transfers tab rendering.

use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Clear, Paragraph, Row, Table, Wrap},
    Frame,
};

use crate::tui::app::{TransferStatus, TransfersTabState};

use crate::tui::App;

/// Render the transfers tab.
pub fn render_transfers_tab(f: &mut Frame, app: &App, area: Rect) {
    match &app.transfers_tab_state {
        TransfersTabState::List => render_transfers_list(f, app, area),
        TransfersTabState::Detail { transfer_id } => {
            render_transfer_detail(f, app, area, transfer_id)
        }
    }
}

/// Render the transfers list view.
fn render_transfers_list(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0)].as_ref())
        .margin(1)
        .split(area);

    // Title and description
    let title = Paragraph::new(vec![
        Line::from(Span::styled(
            "Active Transfers",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![Span::styled(
            format!("{} active transfer(s)", app.transfers.len()),
            Style::default().fg(Color::Gray),
        )]),
    ])
    .alignment(Alignment::Center);

    f.render_widget(title, chunks[0]);

    // Transfers list
    if app.transfers.is_empty() {
        let empty = Paragraph::new(vec![
            Line::from(""),
            Line::from(vec![Span::styled(
                "No active transfers",
                Style::default().fg(Color::DarkGray),
            )]),
            Line::from(""),
            Line::from("Use the Send or Receive tabs to start a transfer."),
        ])
        .alignment(Alignment::Center);

        f.render_widget(empty, chunks[1]);
    } else {
        let header_cells = vec!["Type", "Path", "Status", "Progress", "Size", "Time"];
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
            .transfers
            .iter()
            .enumerate()
            .map(|(idx, transfer)| {
                let is_selected = app.selected_transfer_index == Some(idx);

                let type_style = Style::default().fg(if transfer.transfer_type.name() == "Send" {
                    Color::Green
                } else {
                    Color::Blue
                });

                let status_style = match transfer.status {
                    TransferStatus::Completed => Style::default().fg(Color::Green),
                    TransferStatus::Error(_) => Style::default().fg(Color::Red),
                    TransferStatus::Cancelled => Style::default().fg(Color::DarkGray),
                    _ => Style::default().fg(Color::Yellow),
                };

                let progress_color = if transfer.progress >= 100 {
                    Color::Green
                } else if transfer.progress >= 50 {
                    Color::Yellow
                } else {
                    Color::Red
                };

                let path = if transfer.path.len() > 30 {
                    format!(
                        "...{}",
                        &transfer.path[transfer.path.len().saturating_sub(27)..]
                    )
                } else {
                    transfer.path.clone()
                };

                let row_style = if is_selected {
                    Style::default()
                        .fg(Color::White)
                        .bg(Color::Blue)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                };

                Row::new(vec![
                    Cell::from(transfer.transfer_type.name()).style(type_style),
                    Cell::from(path),
                    Cell::from(format!("{}", transfer.status)).style(status_style),
                    Cell::from(format!("{}%", transfer.progress))
                        .style(Style::default().fg(progress_color)),
                    Cell::from(format_bytes(transfer.total_bytes)),
                    Cell::from(format_time(transfer.created_at)),
                ])
                .style(row_style)
                .height(1)
            })
            .collect();

        let table = Table::new(
            rows,
            [
                Constraint::Percentage(10),
                Constraint::Percentage(25),
                Constraint::Percentage(25),
                Constraint::Percentage(10),
                Constraint::Percentage(15),
                Constraint::Percentage(15),
            ],
        )
        .header(header)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .widths(&[
            Constraint::Percentage(10),
            Constraint::Percentage(25),
            Constraint::Percentage(25),
            Constraint::Percentage(10),
            Constraint::Percentage(15),
            Constraint::Percentage(15),
        ]);

        f.render_widget(table, chunks[1]);
    }
}

/// Render the transfer detail view with ticket and QR code.
fn render_transfer_detail(f: &mut Frame, app: &App, area: Rect, transfer_id: &str) {
    // Get the transfer
    let transfer = match app.get_transfer_by_id(transfer_id) {
        Some(t) => t,
        None => {
            // Transfer not found, show error
            let error = Paragraph::new(vec![
                Line::from(""),
                Line::from(vec![Span::styled(
                    "Transfer not found",
                    Style::default().fg(Color::Red),
                )]),
            ])
            .alignment(Alignment::Center);
            f.render_widget(error, area);
            return;
        }
    };

    let ticket = match &transfer.ticket {
        Some(t) => t,
        None => {
            // No ticket available
            let error = Paragraph::new(vec![
                Line::from(""),
                Line::from(vec![Span::styled(
                    "No ticket available for this transfer",
                    Style::default().fg(Color::Yellow),
                )]),
            ])
            .alignment(Alignment::Center);
            f.render_widget(error, area);
            return;
        }
    };

    // Create a centered popup
    let popup_area = centered_popup_area(area, 70, 80);

    // Clear the popup area
    f.render_widget(Clear, popup_area);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(
            [
                Constraint::Length(3),
                Constraint::Min(0),
                Constraint::Length(3),
            ]
            .as_ref(),
        )
        .split(popup_area);

    // Title
    let title = Paragraph::new(vec![
        Line::from(Span::styled(
            format!("{} Details", transfer.transfer_type.name()),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![Span::styled(
            transfer.path.clone(),
            Style::default().fg(Color::Gray),
        )]),
    ])
    .alignment(Alignment::Center);

    f.render_widget(title, chunks[0]);

    // Generate QR code
    let qr_text = generate_qr_string(ticket);

    // Main content area - ticket first, then QR code
    let mut all_lines = vec![
        Line::from(""),
        Line::from(vec![Span::styled(
            format!("Status: {}", transfer.status),
            Style::default().fg(Color::Yellow),
        )]),
        Line::from(""),
        Line::from(vec![Span::styled(
            "Ticket:",
            Style::default().fg(Color::Yellow),
        )]),
        Line::from(""),
    ];

    // Split ticket into multiple lines if too long
    let chunk_size = 60;
    for chunk in ticket.as_bytes().chunks(chunk_size) {
        all_lines.push(Line::from(vec![Span::styled(
            String::from_utf8_lossy(chunk).to_string(),
            Style::default().fg(Color::Green),
        )]));
    }

    // Add separator and QR code
    all_lines.push(Line::from(""));
    all_lines.push(Line::from(""));
    all_lines.push(Line::from(vec![Span::styled(
        "QR Code:",
        Style::default().fg(Color::Yellow),
    )]));
    all_lines.push(Line::from(""));

    // Add QR code lines
    for line in qr_text.lines() {
        all_lines.push(Line::from(vec![Span::styled(
            line,
            Style::default().fg(Color::White),
        )]));
    }

    let qr_paragraph = Paragraph::new(all_lines)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        )
        .wrap(Wrap { trim: false })
        .alignment(Alignment::Center);

    f.render_widget(qr_paragraph, chunks[1]);

    // Footer with instructions
    let footer = Paragraph::new(vec![Line::from(vec![Span::styled(
        "Press [ESC] to return to transfers list",
        Style::default().fg(Color::Yellow),
    )])])
    .alignment(Alignment::Center);

    f.render_widget(footer, chunks[2]);
}

/// Calculate a centered popup area.
fn centered_popup_area(parent: Rect, percent_width: u16, percent_height: u16) -> Rect {
    let width = parent.width * percent_width / 100;
    let height = parent.height * percent_height / 100;

    let x = (parent.width - width) / 2;
    let y = (parent.height - height) / 2;

    Rect::new(x, y, width, height)
}

/// Generate a string representation of a QR code for the given ticket.
fn generate_qr_string(ticket: &str) -> String {
    use fast_qr::QRBuilder;

    match QRBuilder::new(ticket).build() {
        Ok(qr) => qr.to_str(),
        Err(_) => "[QR Code Error]".to_string(),
    }
}

/// Format bytes to human readable size.
fn format_bytes(bytes: u64) -> String {
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

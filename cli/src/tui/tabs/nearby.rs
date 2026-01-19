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
        .constraints([Constraint::Length(3), Constraint::Min(0)].as_ref())
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
            Line::from("Press [s] to start/stop mDNS discovery."),
            Line::from(""),
            Line::from("Nearby devices on the same network will"),
            Line::from("automatically appear here when discovered."),
        ])
        .alignment(Alignment::Center);

        f.render_widget(empty, chunks[1]);
    } else {
        let header_cells = vec!["Device Name", "Status", "IP Addresses", "Last Seen"];
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
            .map(|device| {
                let name = device.display_name.clone();

                let status_style = if device.available && device.reachable {
                    Style::default().fg(Color::Green)
                } else if device.available {
                    Style::default().fg(Color::Yellow)
                } else {
                    Style::default().fg(Color::DarkGray)
                };

                let status = if device.reachable {
                    "Reachable"
                } else if device.available {
                    "Found"
                } else {
                    "Offline"
                };

                let ips = if device.ip_addresses.is_empty() {
                    "N/A".to_string()
                } else {
                    device.ip_addresses.join(", ")
                };

                let last_seen = format_time(device.last_seen);

                Row::new(vec![
                    Cell::from(name),
                    Cell::from(status).style(status_style),
                    Cell::from(ips),
                    Cell::from(last_seen),
                ])
                .height(1)
            })
            .collect();

        let table = Table::new(
            rows,
            [
                Constraint::Percentage(25),
                Constraint::Percentage(15),
                Constraint::Percentage(40),
                Constraint::Percentage(20),
            ],
        )
        .header(header)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .widths(&[
            Constraint::Percentage(25),
            Constraint::Percentage(15),
            Constraint::Percentage(40),
            Constraint::Percentage(20),
        ]);

        f.render_widget(table, chunks[1]);
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

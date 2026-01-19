//! Receive tab rendering.

use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use crate::tui::App;

/// Render the receive tab.
pub fn render_receive_tab(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(
            [
                Constraint::Length(3),
                Constraint::Min(0),
                Constraint::Length(10),
            ]
            .as_ref(),
        )
        .margin(1)
        .split(area);

    // Title and description
    let title = Paragraph::new(vec![
        Line::from(Span::styled(
            "Receive Files",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![Span::styled(
            "Enter a ticket to receive files from a sender.",
            Style::default().fg(Color::Gray),
        )]),
    ])
    .alignment(Alignment::Center);

    f.render_widget(title, chunks[0]);

    // Input field
    let input_style = Style::default().fg(Color::White).bg(Color::DarkGray);
    let input_text = if app.receive_input_ticket.is_empty() {
        vec![Line::from(Span::styled(
            "Paste ticket here... (e.g., sendme receive <ticket>)",
            Style::default().fg(Color::DarkGray),
        ))]
    } else {
        vec![Line::from(Span::styled(
            &app.receive_input_ticket,
            input_style,
        ))]
    };

    let input = Paragraph::new(input_text)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Blue))
                .title(" Ticket "),
        )
        .wrap(Wrap { trim: true });

    f.render_widget(input, chunks[1]);

    // Instructions and messages
    let help_text = if app.receive_input_ticket.is_empty() {
        vec![
            Line::from(""),
            Line::from(vec![Span::styled(
                "Instructions:",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )]),
            Line::from(""),
            Line::from("  1. Paste or type the ticket from the sender"),
            Line::from("  2. Press [Enter] to start receiving"),
            Line::from("  3. Files will be downloaded to the current directory"),
            Line::from(""),
            Line::from(vec![Span::styled(
                "Ticket format:",
                Style::default().fg(Color::Yellow),
            )]),
            Line::from("  sendme receive <base32-encoded-ticket>"),
            Line::from(""),
            Line::from("The ticket contains connection information"),
            Line::from("and the hash of the files to receive."),
        ]
    } else {
        vec![
            Line::from(""),
            Line::from(vec![Span::styled(
                "Ready to receive:",
                Style::default().fg(Color::Green),
            )]),
            Line::from(""),
            Line::from(vec![Span::styled(
                if app.receive_input_ticket.len() > 60 {
                    format!("{}...", &app.receive_input_ticket[..60])
                } else {
                    app.receive_input_ticket.clone()
                },
                Style::default().fg(Color::White),
            )]),
            Line::from(""),
            if !app.receive_message.is_empty() {
                Line::from(vec![Span::styled(
                    &app.receive_message,
                    Style::default().fg(Color::Yellow),
                )])
            } else {
                Line::from("Press [Enter] to start receiving")
            },
        ]
    };

    let help = Paragraph::new(help_text)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray))
                .title(" Info "),
        )
        .wrap(Wrap { trim: true })
        .alignment(Alignment::Left);

    f.render_widget(help, chunks[2]);
}

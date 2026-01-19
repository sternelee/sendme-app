//! Main UI rendering functions.

use ratatui::{
    backend::Backend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Tabs, Wrap},
    Frame, Terminal,
};

use crate::tui::{
    app::Tab, tabs::nearby::render_nearby_tab, tabs::receive::render_receive_tab,
    tabs::send::render_send_tab, tabs::transfers::render_transfers_tab, App,
};

/// Main UI rendering function.
pub fn render_ui<B: Backend>(terminal: &mut Terminal<B>, app: &App) -> Result<(), std::io::Error> {
    terminal.draw(|f| {
        // Create main layout
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints(
                [
                    Constraint::Length(3),
                    Constraint::Min(0),
                    Constraint::Length(1),
                ]
                .as_ref(),
            )
            .split(f.area());

        // Render header with tabs
        render_header(f, app, chunks[0]);

        // Render current tab content
        render_current_tab(f, app, chunks[1]);

        // Render footer
        render_footer(f, app.current_tab, chunks[2]);
    })?;
    Ok(())
}

/// Render the header with tabs.
fn render_header(f: &mut Frame, app: &App, area: Rect) {
    let titles: Vec<Line> = Tab::all()
        .iter()
        .map(|tab| {
            let style = if *tab == app.current_tab {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::Gray)
            };
            Line::from(Span::styled(format!(" {} ", tab.name()), style))
        })
        .collect();

    let tabs = Tabs::new(titles)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray))
                .title(" Sendme - P2P File Transfer "),
        )
        .style(Style::default().fg(Color::White))
        .highlight_style(Style::default().bg(Color::Blue))
        .divider(Span::raw("|"));

    f.render_widget(tabs, area);
}

/// Render the current tab content.
fn render_current_tab(f: &mut Frame, app: &App, area: Rect) {
    match app.current_tab {
        Tab::Send => render_send_tab(f, app, area),
        Tab::Receive => render_receive_tab(f, app, area),
        Tab::Transfers => render_transfers_tab(f, app, area),
        Tab::Nearby => render_nearby_tab(f, app, area),
    }
}

/// Render the footer with help text.
fn render_footer(f: &mut Frame, current_tab: Tab, area: Rect) {
    let help_text = match current_tab {
        Tab::Send => {
            " [1-4] Switch Tab | [q] Quit | [Enter] Send | [ESC] Return | Type to enter path "
        }
        Tab::Receive => " [1-4] Switch Tab | [q] Quit | [Enter] Receive | Type to paste ticket ",
        Tab::Transfers => {
            " [1-4] Switch Tab | [q] Quit | [Up/Down] Navigate | [Enter] View | [d] Delete | [c] Clean up "
        }
        Tab::Nearby => " [1-4] Switch Tab | [q] Quit | [s] Start/Stop Discovery ",
    };

    let paragraph = Paragraph::new(help_text)
        .style(Style::default().fg(Color::DarkGray))
        .alignment(Alignment::Center);

    f.render_widget(paragraph, area);
}

/// Render a centered popup with QR code or other content.
#[allow(dead_code)]
pub fn render_popup<B: Backend>(
    terminal: &mut Terminal<B>,
    title: &str,
    content: &str,
) -> Result<(), std::io::Error> {
    terminal.draw(|f| {
        let popup_area = centered_popup_area(f.area(), 60, 20);

        f.render_widget(Clear, popup_area);

        let paragraph = Paragraph::new(content)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Cyan))
                    .title(title),
            )
            .wrap(Wrap { trim: false })
            .alignment(Alignment::Center);

        f.render_widget(paragraph, popup_area);
    })?;
    Ok(())
}

/// Calculate a centered popup area.
#[allow(dead_code)]
fn centered_popup_area(parent: Rect, percent_width: u16, percent_height: u16) -> Rect {
    let width = parent.width * percent_width / 100;
    let height = parent.height * percent_height / 100;

    let x = (parent.width - width) / 2;
    let y = (parent.height - height) / 2;

    Rect::new(x, y, width, height)
}

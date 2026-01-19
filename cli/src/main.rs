//! Sendme CLI - Send files over the internet using iroh.
//!
//! Interactive TUI version with ratatui.

use std::path::PathBuf;

use anyhow::Result;
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use sendme_lib::{nearby::NearbyDiscovery, types::*, BlobTicket};
use tokio::sync::mpsc;

mod tui;

use tui::{app::TransferType, App, EventHandler, Transfer};

/// Tick rate for the event loop (ms).
const TICK_RATE_MS: u64 = 250;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    // Setup terminal in a blocking task
    let backend = tokio::task::spawn_blocking(|| {
        enable_raw_mode()?;
        let mut stdout = std::io::stdout();
        execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
        Ok::<_, anyhow::Error>(CrosstermBackend::new(stdout))
    })
    .await??;

    // Create event handler
    let (event_handler, event_rx) = EventHandler::new(TICK_RATE_MS);

    // Create app
    let mut app = App::new();

    // Channels for async operations
    let (send_tx, mut send_rx) = mpsc::channel::<SendRequest>(32);
    let (receive_tx, mut receive_rx) = mpsc::channel::<ReceiveRequest>(32);
    let (nearby_tx, nearby_rx) = mpsc::channel::<NearbyRequest>(32);

    // Spawn background tasks
    let send_event_handler = event_handler.clone();
    tokio::spawn(async move {
        while let Some(event) = send_rx.recv().await {
            if let Err(e) = handle_send_request(event, send_event_handler.clone()).await {
                eprintln!("Send error: {}", e);
            }
        }
    });

    let receive_event_handler = event_handler.clone();
    tokio::spawn(async move {
        while let Some(event) = receive_rx.recv().await {
            if let Err(e) = handle_receive_request(event, receive_event_handler.clone()).await {
                eprintln!("Receive error: {}", e);
            }
        }
    });

    let nearby_event_handler = event_handler.clone();
    tokio::spawn(async move {
        handle_nearby_requests(nearby_rx, nearby_event_handler).await;
    });

    // Run the event loop in a blocking task, then restore terminal
    tokio::task::spawn_blocking(move || {
        let mut terminal = Terminal::new(backend)?;

        loop {
            // Render UI
            tui::render_ui(&mut terminal, &app)?;

            // Process all pending events (non-blocking)
            loop {
                match event_rx.try_recv() {
                    Ok(tui::event::AppEvent::Input(key)) => {
                        app.handle_key(key);

                        // Handle send tab enter key
                        if app.current_tab == tui::app::Tab::Send {
                            if let crossterm::event::KeyCode::Enter = key.code {
                                if !app.send_input_path.is_empty() {
                                    let path = app.send_input_path.clone();
                                    let transfer_id = uuid::Uuid::new_v4().to_string();

                                    let mut transfer =
                                        Transfer::new(TransferType::Send, path.clone());
                                    transfer.id = transfer_id.clone();
                                    app.add_transfer(transfer.clone());

                                    app.send_input_path.clear();
                                    app.send_message = format!("Initiating send for: {}", path);

                                    // Use try_send in spawn_blocking context
                                    let _ = send_tx.try_send(SendRequest { path, transfer_id });
                                }
                            }
                        }

                        // Handle receive tab enter key
                        if app.current_tab == tui::app::Tab::Receive {
                            if let crossterm::event::KeyCode::Enter = key.code {
                                if !app.receive_input_ticket.is_empty() {
                                    let ticket_str = app.receive_input_ticket.trim();
                                    let transfer_id = uuid::Uuid::new_v4().to_string();

                                    // Parse ticket
                                    let ticket = match parse_ticket(ticket_str) {
                                        Ok(t) => t,
                                        Err(e) => {
                                            app.receive_message = format!("Invalid ticket: {}", e);
                                            app.receive_input_ticket.clear();
                                            continue;
                                        }
                                    };

                                    let mut transfer = Transfer::new(
                                        TransferType::Receive,
                                        format!("from ticket"),
                                    );
                                    transfer.id = transfer_id.clone();
                                    app.add_transfer(transfer.clone());

                                    app.receive_input_ticket.clear();
                                    app.receive_message = "Initiating receive...".to_string();

                                    // Use try_send in spawn_blocking context
                                    let _ = receive_tx.try_send(ReceiveRequest {
                                        ticket,
                                        transfer_id,
                                    });
                                }
                            }
                        }

                        // Handle transfers tab cleanup
                        if app.current_tab == tui::app::Tab::Transfers {
                            if let crossterm::event::KeyCode::Char('c') = key.code {
                                app.cleanup_finished_transfers();
                            }
                        }

                        // Handle nearby tab toggle
                        if app.current_tab == tui::app::Tab::Nearby {
                            if let crossterm::event::KeyCode::Char('s') = key.code {
                                app.nearby_enabled = !app.nearby_enabled;
                                let _ = nearby_tx.send(if app.nearby_enabled {
                                    NearbyRequest::Start
                                } else {
                                    NearbyRequest::Stop
                                });
                            }
                        }
                    }
                    Ok(tui::event::AppEvent::Tick) => {
                        // Periodic updates
                    }
                    Ok(tui::event::AppEvent::TransferUpdate(event)) => {
                        // Update transfers based on event
                        for transfer in &mut app.transfers {
                            transfer.update_progress(&event);
                        }
                    }
                    Ok(tui::event::AppEvent::NearbyDeviceUpdate(devices)) => {
                        app.update_nearby_devices(devices);
                    }
                    Ok(tui::event::AppEvent::SendCompleted { ticket, path }) => {
                        // Store ticket in the transfer and show success view
                        if let Some(transfer) = app.transfers.last_mut() {
                            transfer.ticket = Some(ticket.clone());
                            transfer.status = tui::app::TransferStatus::Serving;
                        }
                        app.set_send_success(ticket, path);
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => {
                        // No more events, break inner loop
                        break;
                    }
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        // Channel closed, exit
                        return Ok(());
                    }
                }
            }

            if !app.running {
                break;
            }

            // Small sleep to prevent busy-waiting
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        // Restore terminal before returning
        disable_raw_mode()?;
        execute!(
            terminal.backend_mut(),
            LeaveAlternateScreen,
            DisableMouseCapture
        )?;
        terminal.show_cursor()?;

        Ok::<(), anyhow::Error>(())
    })
    .await??;

    Ok(())
}

/// Parse a ticket string, handling various formats.
fn parse_ticket(s: &str) -> Result<BlobTicket> {
    let s = s.trim();

    // Remove "sendme receive" prefix if present
    let s = if s.starts_with("sendme receive ") {
        s["sendme receive ".len()..].trim()
    } else {
        s
    };

    s.parse::<BlobTicket>()
        .map_err(|e| anyhow::anyhow!("Failed to parse ticket: {}", e))
}

/// Send request.
#[allow(dead_code)]
struct SendRequest {
    path: String,
    transfer_id: String,
}

/// Receive request.
#[allow(dead_code)]
struct ReceiveRequest {
    ticket: BlobTicket,
    transfer_id: String,
}

/// Nearby request.
enum NearbyRequest {
    Start,
    Stop,
}

/// Handle a send request.
async fn handle_send_request(request: SendRequest, event_handler: EventHandler) -> Result<()> {
    let path = PathBuf::from(&request.path);

    if !path.exists() {
        return Err(anyhow::anyhow!("Path does not exist: {}", request.path));
    }

    let args = SendArgs {
        path,
        ticket_type: AddrInfoOptions::RelayAndAddresses,
        common: CommonConfig::default(),
    };

    let (progress_tx, mut progress_rx) = mpsc::channel(32);
    let event_handler_clone = event_handler.clone();
    let request_path_clone = request.path.clone();

    // Spawn progress forwarding task (runs indefinitely for connection events)
    tokio::spawn(async move {
        while let Some(event) = progress_rx.recv().await {
            event_handler_clone.send_transfer_update(event);
        }
    });

    // Run send_with_progress and send completion event
    match sendme_lib::send_with_progress(args, progress_tx).await {
        Ok(result) => {
            event_handler.send_send_completed(result.ticket.to_string(), request_path_clone);
        }
        Err(e) => {
            eprintln!("Send error: {}", e);
        }
    }

    Ok(())
}

/// Handle a receive request.
async fn handle_receive_request(
    request: ReceiveRequest,
    event_handler: EventHandler,
) -> Result<()> {
    let args = ReceiveArgs {
        ticket: request.ticket,
        common: CommonConfig::default(),
        export_dir: None,
    };

    let (progress_tx, mut progress_rx) = mpsc::channel(32);
    let event_handler_clone = event_handler.clone();

    // Spawn progress forwarding task
    tokio::spawn(async move {
        while let Some(event) = progress_rx.recv().await {
            event_handler_clone.send_transfer_update(event);
        }
    });

    // Run receive operation
    if let Err(e) = sendme_lib::receive_with_progress(args, progress_tx).await {
        eprintln!("Receive error: {}", e);
    }

    Ok(())
}

/// Handle nearby discovery requests.
async fn handle_nearby_requests(
    mut rx: tokio::sync::mpsc::Receiver<NearbyRequest>,
    event_handler: EventHandler,
) {
    // Use an atomic flag to track if discovery is running
    let running = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    while let Some(request) = rx.recv().await {
        match request {
            NearbyRequest::Start => {
                if running.load(std::sync::atomic::Ordering::Relaxed) {
                    continue;
                }

                match NearbyDiscovery::new().await {
                    Ok(d) => {
                        running.store(true, std::sync::atomic::Ordering::Relaxed);

                        let event_handler = event_handler.clone();
                        let running_clone = running.clone();

                        tokio::spawn(async move {
                            let mut discovery = d;
                            while running_clone.load(std::sync::atomic::Ordering::Relaxed) {
                                if let Err(e) = discovery.poll().await {
                                    eprintln!("Nearby poll error: {}", e);
                                }
                                let devices = discovery.devices().to_vec();
                                event_handler.send_nearby_update(devices);
                                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("Failed to start nearby discovery: {}", e);
                    }
                }
            }
            NearbyRequest::Stop => {
                running.store(false, std::sync::atomic::Ordering::Relaxed);
                event_handler.send_nearby_update(vec![]);
            }
        }
    }
}

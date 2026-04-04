//! Sendme CLI - Send files over the internet using iroh.
//!
//! Supports both interactive TUI mode and command-line mode.

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use indicatif::HumanBytes;
use ratatui::{backend::CrosstermBackend, Terminal};
use sendme_lib::{
    types::{CommonConfig, Format, RelayModeOption},
    BlobTicket, ReceiveArgs, SendArgs,
};
use tokio::sync::mpsc;

mod tui;

use tui::{app::TransferType, App, EventHandler, Transfer};

/// Tick rate for the event loop (ms).
const TICK_RATE_MS: u64 = 250;

#[derive(Parser, Debug)]
#[command(name = "sendme")]
#[command(version, about = "Send files over the internet using iroh")]
struct Cli {
    #[clap(subcommand)]
    pub command: Option<Commands>,

    /// Launch interactive TUI mode.
    #[clap(long, short = 't')]
    pub tui: bool,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Send a file or directory.
    Send(SendArgs2),

    /// Receive a file or directory.
    #[clap(visible_alias = "recv")]
    Receive(ReceiveArgs2),
}

#[derive(Parser, Debug)]
pub struct CommonArgs {
    /// The IPv4 address that magicsocket will listen on.
    #[clap(long)]
    pub magic_ipv4_addr: Option<std::net::SocketAddrV4>,

    /// The IPv6 address that magicsocket will listen on.
    #[clap(long)]
    pub magic_ipv6_addr: Option<std::net::SocketAddrV6>,

    /// Hash output format.
    #[clap(long, default_value_t = Format::Hex)]
    pub format: Format,

    /// Verbosity level (can stack: -vv).
    #[clap(short = 'v', long, action = clap::ArgAction::Count)]
    pub verbose: u8,

    /// Suppress progress bars.
    #[clap(long)]
    pub no_progress: bool,

    /// The relay URL to use as a home relay.
    /// Can be set to "disabled", "default", or a custom URL.
    #[clap(long, default_value_t = RelayModeOption::Default)]
    pub relay: RelayModeOption,

    /// Show the secret key on stderr.
    #[clap(long)]
    pub show_secret: bool,
}

#[derive(Parser, Debug)]
pub struct SendArgs2 {
    /// Path to the file or directory to send.
    #[clap(required = true)]
    pub path: PathBuf,

    /// What type of ticket to use.
    #[clap(long, default_value_t = sendme_lib::types::AddrInfoOptions::RelayAndAddresses)]
    pub ticket_type: sendme_lib::types::AddrInfoOptions,

    #[clap(flatten)]
    pub common: CommonArgs,

    /// Store the receive command in the clipboard.
    #[cfg(feature = "clipboard")]
    #[clap(short = 'c', long)]
    pub clipboard: bool,
}

#[derive(Parser, Debug)]
pub struct ReceiveArgs2 {
    /// The ticket to use to connect to the sender.
    #[clap(required = true)]
    pub ticket: BlobTicket,

    #[clap(flatten)]
    pub common: CommonArgs,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Some(Commands::Send(args)) => {
            do_send(args).await?;
        }
        Some(Commands::Receive(args)) => {
            do_receive(args).await?;
        }
        None => {
            // No subcommand - launch TUI by default
            run_tui().await?;
        }
    }

    Ok(())
}

fn common_args_to_config(common: &CommonArgs) -> CommonConfig {
    CommonConfig {
        magic_ipv4_addr: common.magic_ipv4_addr,
        magic_ipv6_addr: common.magic_ipv6_addr,
        format: common.format,
        relay: common.relay.clone(),
        show_secret: common.show_secret,
        temp_dir: None,
    }
}

/// Command-line send implementation.
async fn do_send(args: &SendArgs2) -> Result<()> {
    let secret_key = sendme_lib::get_or_create_secret(args.common.verbose > 0)?;
    if args.common.show_secret {
        let secret_key = hex::encode(secret_key.to_bytes());
        eprintln!("using secret key {secret_key}");
    }

    let send_args = SendArgs {
        path: args.path.clone(),
        ticket_type: args.ticket_type,
        common: common_args_to_config(&args.common),
    };

    let result = sendme_lib::send_with_progress(send_args, mpsc::channel(32).0).await?;

    let entry_type = if args.path.is_file() {
        "file"
    } else {
        "directory"
    };

    println!(
        "imported {} {}, {}, hash {}",
        entry_type,
        args.path.display(),
        HumanBytes(result.total_size),
        result.hash
    );

    println!("to get this data, use");
    println!("sendme receive {}", result.ticket);

    #[cfg(feature = "clipboard")]
    if args.clipboard {
        copy_to_clipboard(&format!("sendme receive {}", result.ticket));
    }

    // Wait for Ctrl+C to shut down
    tokio::signal::ctrl_c().await?;

    println!("shutting down");
    Ok(())
}

/// Command-line receive implementation.
async fn do_receive(args: &ReceiveArgs2) -> Result<()> {
    let secret_key = sendme_lib::get_or_create_secret(args.common.verbose > 0)?;
    if args.common.show_secret {
        let secret_key = hex::encode(secret_key.to_bytes());
        eprintln!("using secret key {secret_key}");
    }

    let receive_args = ReceiveArgs {
        ticket: args.ticket.clone(),
        common: common_args_to_config(&args.common),
        export_dir: None,
    };

    let result = sendme_lib::receive_with_progress(receive_args, mpsc::channel(32).0).await?;

    println!(
        "downloaded {} files, {}",
        result.total_files,
        HumanBytes(result.payload_size)
    );

    Ok(())
}

#[cfg(feature = "clipboard")]
fn copy_to_clipboard(content: &str) {
    #[cfg(unix)]
    {
        use std::process::Command;
        Command::new("pbcopy").arg(content).output().ok();
    }
    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("cmd")
            .args(["/C", &format!("echo {} | clip", content)])
            .output()
            .ok();
    }
}

/// Interactive TUI implementation.
async fn run_tui() -> Result<()> {
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

/// Handle a send request.
async fn handle_send_request(request: SendRequest, event_handler: EventHandler) -> Result<()> {
    use sendme_lib::types::{AddrInfoOptions, SendArgs};

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
    use sendme_lib::types::{CommonConfig, ReceiveArgs};

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

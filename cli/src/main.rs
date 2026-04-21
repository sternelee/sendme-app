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
    BlobTicket, ImportMode, ReceiveArgs, SendArgs,
};
use tokio::sync::mpsc;

mod cloud;
mod config;
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

    /// Log in with an API key for cloud features.
    Login(LoginArgs),

    /// List your registered devices.
    Devices,

    /// List your friends.
    Friends,
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

    /// Send to a specific device by ID (cloud feature).
    #[clap(long)]
    pub to_device: Option<String>,

    /// Send to a friend by user ID (cloud feature).
    #[clap(long)]
    pub to_friend: Option<String>,
}

#[derive(Parser, Debug)]
pub struct LoginArgs {
    /// API key (sk_...). Generate one from the web app settings.
    #[clap(long)]
    pub api_key: Option<String>,

    /// Device name for this CLI instance.
    #[clap(long)]
    pub device_name: Option<String>,

    /// API origin URL (default: https://sendme.leeapp.dev).
    #[clap(long)]
    pub api_origin: Option<String>,
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
        Some(Commands::Login(args)) => {
            do_login(args).await?;
        }
        Some(Commands::Devices) => {
            do_list_devices().await?;
        }
        Some(Commands::Friends) => {
            do_list_friends().await?;
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
        import_mode: ImportMode::TryReference,
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

    // If sending to a cloud target, push the ticket
    if args.to_device.is_some() || args.to_friend.is_some() {
        let mut config = config::Config::load()?;
        let api_key = config
            .api_key
            .as_ref()
            .ok_or_else(|| {
                anyhow::anyhow!("Not logged in. Run `sendme login --api-key <key>` first.")
            })?
            .clone();
        let device_id = config.get_or_create_device_id();
        let cloud =
            cloud::CloudClient::new(config.api_origin().to_string(), api_key, device_id.clone());

        // We need our device DB ID - register/upsert first
        let device_name = config.get_device_name();
        let my_device = cloud
            .register_device(
                &device_name,
                hostname::get()
                    .ok()
                    .and_then(|h| h.into_string().ok())
                    .as_deref(),
            )
            .await?;

        let filename = args.path.file_name().and_then(|n| n.to_str());
        let ticket_str = result.ticket.to_string();

        if let Some(ref target_device) = args.to_device {
            cloud
                .send_ticket_to_device(target_device, &my_device.id, &ticket_str, filename)
                .await?;
            println!("ticket sent to device {}", target_device);
        }
        if let Some(ref target_friend) = args.to_friend {
            cloud
                .send_ticket_to_friend(target_friend, &my_device.id, &ticket_str, filename)
                .await?;
            println!("ticket sent to friend {}", target_friend);
        }
    }

    // Wait for Ctrl+C to shut down
    tokio::signal::ctrl_c().await?;

    println!("shutting down");
    Ok(())
}

/// Login: store API key and register as a CLI device.
async fn do_login(args: &LoginArgs) -> Result<()> {
    let api_key = if let Some(ref key) = args.api_key {
        key.clone()
    } else {
        // Prompt interactively
        eprint!("Enter API key (sk_...): ");
        let mut key = String::new();
        std::io::stdin().read_line(&mut key)?;
        key.trim().to_string()
    };

    if !api_key.starts_with("sk_") {
        anyhow::bail!("Invalid API key format. Keys start with 'sk_'.");
    }

    let mut config = config::Config::load().unwrap_or_default();
    config.api_key = Some(api_key.clone());

    if let Some(ref name) = args.device_name {
        config.device_name = Some(name.clone());
    }
    if let Some(ref origin) = args.api_origin {
        config.api_origin = Some(origin.clone());
    }

    let device_id = config.get_or_create_device_id();
    let device_name = config.get_device_name();

    // Register this CLI as a device
    let cloud = cloud::CloudClient::new(config.api_origin().to_string(), api_key, device_id);

    let hostname_str = hostname::get().ok().and_then(|h| h.into_string().ok());
    let device = cloud
        .register_device(&device_name, hostname_str.as_deref())
        .await?;

    config.save()?;

    println!("✓ Logged in successfully");
    println!("  Device: {} ({})", device.name, device.platform);
    println!("  Config saved to: {}", config_path_display());

    Ok(())
}

/// List devices for the authenticated user.
async fn do_list_devices() -> Result<()> {
    let mut config = config::Config::load()?;
    let api_key = config
        .api_key
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Not logged in. Run `sendme login --api-key <key>` first."))?
        .clone();
    let device_id = config.get_or_create_device_id();

    let cloud = cloud::CloudClient::new(config.api_origin().to_string(), api_key, device_id);

    let devices = cloud.list_devices().await?;

    if devices.is_empty() {
        println!("No devices registered.");
        return Ok(());
    }

    println!(
        "{:<36}  {:<15}  {:<8}  {}",
        "ID", "NAME", "PLATFORM", "STATUS"
    );
    for d in &devices {
        let status = if d.online.unwrap_or(false) {
            "online"
        } else {
            "offline"
        };
        println!(
            "{:<36}  {:<15}  {:<8}  {}",
            d.id, d.name, d.platform, status
        );
    }

    Ok(())
}

/// List friends for the authenticated user.
async fn do_list_friends() -> Result<()> {
    let mut config = config::Config::load()?;
    let api_key = config
        .api_key
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Not logged in. Run `sendme login --api-key <key>` first."))?
        .clone();
    let device_id = config.get_or_create_device_id();

    let cloud = cloud::CloudClient::new(config.api_origin().to_string(), api_key, device_id);

    let friends = cloud.list_friends().await?;

    if friends.is_empty() {
        println!("No friends yet.");
        return Ok(());
    }

    println!("{:<36}  {:<20}  {}", "USER ID", "NAME", "STATUS");
    for f in &friends {
        let name = f.name.as_deref().unwrap_or("—");
        let user_id = f.friend_user_id.as_deref().unwrap_or(&f.id);
        println!("{:<36}  {:<20}  {}", user_id, name, f.status);
    }

    Ok(())
}

fn config_path_display() -> String {
    dirs::config_dir()
        .unwrap_or_default()
        .join("sendme")
        .join("config.toml")
        .display()
        .to_string()
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
    // Load config (may not exist yet)
    let config = config::Config::load().unwrap_or_default();

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
    let (cloud_send_tx, mut cloud_send_rx) = mpsc::channel::<CloudSendRequest>(32);

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

    // Spawn cloud-send dispatcher
    tokio::spawn(async move {
        while let Some(req) = cloud_send_rx.recv().await {
            if let Err(e) = handle_cloud_send(req).await {
                eprintln!("Cloud send error: {}", e);
            }
        }
    });

    // If logged in, spawn cloud WS background task
    if let Some(api_key) = config.api_key.clone() {
        let ws_eh = event_handler.clone();
        let base_url = config.api_origin().to_string();
        let device_id = {
            let mut cfg = config::Config::load().unwrap_or_default();
            cfg.get_or_create_device_id()
        };
        let device_name = config.get_device_name();

        // Mark as connecting
        ws_eh.emit(tui::event::AppEvent::CloudConnected);

        tokio::spawn(async move {
            // Register / upsert device first to get DB id
            let cloud =
                cloud::CloudClient::new(base_url.clone(), api_key.clone(), device_id.clone());
            let hostname_str = hostname::get().ok().and_then(|h| h.into_string().ok());
            if let Ok(device) = cloud
                .register_device(&device_name, hostname_str.as_deref())
                .await
            {
                ws_eh.emit(tui::event::AppEvent::CloudDeviceRegistered(device.id));
            }

            // Bridge: tokio mpsc → EventHandler
            let (ws_tx, mut ws_rx) = mpsc::channel::<cloud::WsMessage>(64);
            let bridge_eh = ws_eh.clone();
            tokio::spawn(async move {
                while let Some(msg) = ws_rx.recv().await {
                    let event = match msg {
                        cloud::WsMessage::Connected => tui::event::AppEvent::CloudConnected,
                        cloud::WsMessage::Disconnected => tui::event::AppEvent::CloudDisconnected,
                        cloud::WsMessage::Devices(d) => {
                            tui::event::AppEvent::CloudDevicesUpdated(d)
                        }
                        cloud::WsMessage::Friends(f) => {
                            tui::event::AppEvent::CloudFriendsUpdated(f)
                        }
                        cloud::WsMessage::Tickets(t) => {
                            tui::event::AppEvent::CloudTicketsUpdated(t)
                        }
                        cloud::WsMessage::Notification(n) => {
                            tui::event::AppEvent::CloudNotification(n)
                        }
                        cloud::WsMessage::DeviceRegistered(id) => {
                            tui::event::AppEvent::CloudDeviceRegistered(id)
                        }
                    };
                    bridge_eh.emit(event);
                }
            });

            // Run WS loop (reconnects automatically)
            cloud::run_ws_loop(base_url, api_key, device_id, ws_tx).await;
        });
    }

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
                                // If a cloud popup is open, handle Enter there
                                if app.send_cloud_state != tui::app::SendCloudState::None {
                                    let ticket = app.send_success_ticket.clone();
                                    let path = app.send_success_path.clone();
                                    let my_device_id = app.cloud_my_device_db_id.clone();
                                    let state = app.send_cloud_state.clone();
                                    let idx = app.send_cloud_selected_index;
                                    app.send_cloud_state = tui::app::SendCloudState::None;

                                    if let (Some(ticket_str), Some(_path), Some(sender_id)) =
                                        (ticket, path, my_device_id)
                                    {
                                        let req = match state {
                                            tui::app::SendCloudState::SelectingDevice => app
                                                .cloud_devices
                                                .get(idx)
                                                .map(|d| CloudSendRequest {
                                                    ticket: ticket_str.clone(),
                                                    sender_device_id: sender_id.clone(),
                                                    target: CloudSendTarget::Device(d.id.clone()),
                                                    filename: None,
                                                }),
                                            tui::app::SendCloudState::SelectingFriend => {
                                                app.cloud_friends.get(idx).map(|f| {
                                                    let friend_id = f
                                                        .friend
                                                        .as_ref()
                                                        .map(|fi| fi.id.clone())
                                                        .unwrap_or_else(|| f.id.clone());
                                                    CloudSendRequest {
                                                        ticket: ticket_str.clone(),
                                                        sender_device_id: sender_id.clone(),
                                                        target: CloudSendTarget::Friend(friend_id),
                                                        filename: None,
                                                    }
                                                })
                                            }
                                            tui::app::SendCloudState::None => None,
                                        };
                                        if let Some(r) = req {
                                            let _ = cloud_send_tx.try_send(r);
                                        }
                                    }
                                } else if !app.send_input_path.is_empty() {
                                    let path = app.send_input_path.clone();
                                    let transfer_id = uuid::Uuid::new_v4().to_string();

                                    let mut transfer =
                                        Transfer::new(TransferType::Send, path.clone());
                                    transfer.id = transfer_id.clone();
                                    app.add_transfer(transfer.clone());

                                    app.send_input_path.clear();
                                    app.send_message = format!("Initiating send for: {}", path);

                                    let _ = send_tx.try_send(SendRequest { path, transfer_id });
                                }
                            }
                        }

                        // Handle receive tab enter key
                        if app.current_tab == tui::app::Tab::Receive {
                            if let crossterm::event::KeyCode::Enter = key.code {
                                if !app.receive_input_ticket.is_empty() {
                                    let ticket_str = app.receive_input_ticket.trim().to_string();
                                    let transfer_id = uuid::Uuid::new_v4().to_string();

                                    // Parse ticket
                                    let ticket = match parse_ticket(&ticket_str) {
                                        Ok(t) => t,
                                        Err(e) => {
                                            app.receive_message = format!("Invalid ticket: {}", e);
                                            app.receive_input_ticket.clear();
                                            continue;
                                        }
                                    };

                                    let mut transfer = Transfer::new(
                                        TransferType::Receive,
                                        "from ticket".to_string(),
                                    );
                                    transfer.id = transfer_id.clone();
                                    app.add_transfer(transfer.clone());

                                    app.receive_input_ticket.clear();
                                    app.receive_message = "Initiating receive...".to_string();

                                    let _ = receive_tx.try_send(ReceiveRequest {
                                        ticket,
                                        transfer_id,
                                    });
                                }
                            }
                        }

                        // Handle Cloud tab Enter (receive incoming ticket)
                        if app.current_tab == tui::app::Tab::Cloud {
                            if let crossterm::event::KeyCode::Enter = key.code {
                                if app.cloud_section == tui::app::CloudSection::Incoming {
                                    let idx = app.cloud_selected_index;
                                    if let Some(pending) =
                                        app.cloud_pending_tickets.get(idx).cloned()
                                    {
                                        let ticket_str = pending.ticket.clone();
                                        let ticket_id = pending.id.clone();
                                        // Remove from list optimistically
                                        app.cloud_pending_tickets.remove(idx);
                                        if app.cloud_selected_index
                                            >= app.cloud_pending_tickets.len()
                                            && app.cloud_selected_index > 0
                                        {
                                            app.cloud_selected_index -= 1;
                                        }

                                        // Start receive
                                        match parse_ticket(&ticket_str) {
                                            Ok(ticket) => {
                                                let transfer_id = uuid::Uuid::new_v4().to_string();
                                                let name = pending
                                                    .filename
                                                    .as_deref()
                                                    .unwrap_or("file")
                                                    .to_string();
                                                let mut transfer =
                                                    Transfer::new(TransferType::Receive, name);
                                                transfer.id = transfer_id.clone();
                                                app.add_transfer(transfer);
                                                app.receive_message =
                                                    "Receiving from cloud ticket...".to_string();
                                                let _ = receive_tx.try_send(ReceiveRequest {
                                                    ticket,
                                                    transfer_id,
                                                });
                                            }
                                            Err(e) => {
                                                app.cloud_notification =
                                                    Some(format!("Bad ticket: {e}"));
                                            }
                                        }

                                        // Mark ticket received in background
                                        // We use a simple fire-and-forget here via the cloud_send_tx mechanism
                                        let _ = cloud_send_tx.try_send(CloudSendRequest {
                                            ticket: ticket_id,
                                            sender_device_id: String::new(),
                                            target: CloudSendTarget::MarkReceived,
                                            filename: None,
                                        });
                                    }
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
                    Ok(tui::event::AppEvent::TransferUpdate { transfer_id, event }) => {
                        app.update_progress(&event, &transfer_id);
                    }
                    Ok(tui::event::AppEvent::SendCompleted {
                        transfer_id,
                        ticket,
                        path,
                    }) => {
                        if let Some(transfer) =
                            app.transfers.iter_mut().find(|t| t.id == transfer_id)
                        {
                            transfer.ticket = Some(ticket.clone());
                            transfer.status = tui::app::TransferStatus::Serving;
                        }
                        app.set_send_success(ticket, path);
                    }
                    // --- Cloud events ---
                    Ok(tui::event::AppEvent::CloudConnected) => {
                        app.cloud_ws_state = tui::app::CloudWsState::Connected;
                    }
                    Ok(tui::event::AppEvent::CloudDisconnected) => {
                        app.cloud_ws_state = tui::app::CloudWsState::Reconnecting;
                    }
                    Ok(tui::event::AppEvent::CloudDevicesUpdated(devices)) => {
                        app.cloud_devices = devices;
                    }
                    Ok(tui::event::AppEvent::CloudFriendsUpdated(friends)) => {
                        app.cloud_friends = friends;
                    }
                    Ok(tui::event::AppEvent::CloudTicketsUpdated(tickets)) => {
                        let prev_count = app.cloud_pending_tickets.len();
                        let new_count = tickets.len();
                        app.cloud_pending_tickets = tickets;
                        // Notify the user if new tickets arrived
                        if new_count > prev_count {
                            let delta = new_count - prev_count;
                            app.cloud_notification = Some(format!(
                                "📥 {} new incoming file{} — switch to Cloud › Incoming",
                                delta,
                                if delta == 1 { "" } else { "s" }
                            ));
                        }
                    }
                    Ok(tui::event::AppEvent::CloudNotification(msg)) => {
                        app.cloud_notification = Some(msg);
                    }
                    Ok(tui::event::AppEvent::CloudDeviceRegistered(id)) => {
                        app.cloud_my_device_db_id = Some(id);
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

/// Cloud send target.
#[allow(dead_code)]
enum CloudSendTarget {
    Device(String),
    Friend(String),
    MarkReceived,
}

/// Cloud send request (device or friend).
#[allow(dead_code)]
struct CloudSendRequest {
    ticket: String,
    sender_device_id: String,
    target: CloudSendTarget,
    filename: Option<String>,
}

/// Handle a cloud send request.
async fn handle_cloud_send(req: CloudSendRequest) -> Result<()> {
    let config = config::Config::load().unwrap_or_default();
    let api_key = match config.api_key.clone() {
        Some(k) => k,
        None => return Ok(()),
    };
    let device_id = {
        let mut cfg = config::Config::load().unwrap_or_default();
        cfg.get_or_create_device_id()
    };
    let cloud = cloud::CloudClient::new(config.api_origin().to_string(), api_key, device_id);

    match req.target {
        CloudSendTarget::Device(target_id) => {
            cloud
                .send_ticket_to_device(
                    &target_id,
                    &req.sender_device_id,
                    &req.ticket,
                    req.filename.as_deref(),
                )
                .await?;
        }
        CloudSendTarget::Friend(friend_id) => {
            cloud
                .send_ticket_to_friend(
                    &friend_id,
                    &req.sender_device_id,
                    &req.ticket,
                    req.filename.as_deref(),
                )
                .await?;
        }
        CloudSendTarget::MarkReceived => {
            let _ = cloud.mark_ticket_received(&req.ticket).await;
        }
    }

    Ok(())
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
        import_mode: ImportMode::TryReference,
    };

    let (progress_tx, mut progress_rx) = mpsc::channel(32);
    let event_handler_clone = event_handler.clone();
    let transfer_id_clone = request.transfer_id.clone();

    // Spawn progress forwarding task (runs indefinitely for connection events)
    tokio::spawn(async move {
        while let Some(event) = progress_rx.recv().await {
            event_handler_clone.send_transfer_update(transfer_id_clone.clone(), event);
        }
    });

    // Run send_with_progress and send completion event
    match sendme_lib::send_with_progress(args, progress_tx).await {
        Ok(result) => {
            event_handler.send_send_completed(
                request.transfer_id,
                result.ticket.to_string(),
                request.path,
            );
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
    let transfer_id_clone = request.transfer_id.clone();

    // Spawn progress forwarding task
    tokio::spawn(async move {
        while let Some(event) = progress_rx.recv().await {
            event_handler_clone.send_transfer_update(transfer_id_clone.clone(), event);
        }
    });

    // Run receive operation
    if let Err(e) = sendme_lib::receive_with_progress(args, progress_tx).await {
        eprintln!("Receive error: {}", e);
    }

    Ok(())
}

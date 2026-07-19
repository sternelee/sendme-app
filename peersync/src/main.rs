//! PeerSync standalone CLI binary.
//!
//! Runs the peersync daemon, shows status, links devices, and manages config
//! without the sendme TUI. Intended for headless / SSH / launchd scenarios.
//!
//! By default, config and data live at:
//!   config: ~/.config/sendme/peersync/
//!   data:   ~/.local/share/sendme/peersync/
//!
//! Override with `--config-dir` / `--data-dir` or `PEERSYNC_CONFIG_DIR` /
//! `PEERSYNC_DATA_DIR` environment variables.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

mod tui;
use tui::{event::AppEvent, EventHandler};

// ----- CLI definition -----

#[derive(Parser, Debug)]
#[command(name = "peersync")]
#[command(
    version,
    about = "Peer-to-peer config file sync over Iroh",
    long_about = "Keeps dotfiles and config directories in sync across your devices \
                   using iroh's peer-to-peer transport. Each device runs a daemon that \
                   watches local files and exchanges changes with peers."
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Path to the config directory.
    #[arg(long, env = "PEERSYNC_CONFIG_DIR")]
    config_dir: Option<PathBuf>,

    /// Path to the data directory (SQLite DB, iroh blobs/docs).
    #[arg(long, env = "PEERSYNC_DATA_DIR")]
    data_dir: Option<PathBuf>,

    /// Be quiet (equivalent to RUST_LOG=error).
    #[arg(short, long)]
    quiet: bool,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Launch the interactive TUI (terminal UI).
    Tui,

    /// Run the sync daemon (watches files, exchanges changes).
    Run {
        /// Do not start automatically; wait for manual signal instead.
        #[arg(long)]
        no_auto_sync: bool,
    },

    /// Show sync status — device info, peers, targets, conflict files.
    #[command(alias = "st")]
    Status {
        /// Show conflict files with full paths.
        #[arg(long, short)]
        conflicts: bool,
    },

    /// Show recent sync history.
    #[command(alias = "lg")]
    Log {
        /// Target filter (only show events for this target key).
        #[arg(long, short)]
        target: Option<String>,

        /// Number of entries to show.
        #[arg(long, short = 'n', default_value = "20")]
        lines: usize,
    },

    /// Run garbage collection — prune old conflict backups and history.
    Gc {
        /// Retention period in days (default: 30).
        #[arg(long, short = 'r', default_value = "30")]
        retention_days: u64,

        /// Dry-run: do not actually delete anything.
        #[arg(long, short = 'n')]
        dry_run: bool,
    },

    /// Link to an existing sync doc using a host ticket.
    ///
    /// Paste the ticket from another device's `peersync ticket` output.
    /// This device will join the same sync namespace.
    Link {
        /// Doc ticket from the host device.
        ticket: String,
    },

    /// Print the current doc ticket (for sharing with another device).
    Ticket,

    /// Manage sync configuration.
    #[command(alias = "cfg")]
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
}

#[derive(Subcommand, Debug)]
enum ConfigAction {
    /// Show current configuration.
    Show,

    /// Set the device name.
    SetName { name: String },

    /// Add a sync target.
    Add {
        /// Label for the target (slug used in logs).
        #[arg(short, long)]
        label: Option<String>,

        /// Path to watch.
        path: String,
    },

    /// Remove a sync target by label.
    #[command(alias = "rm")]
    Remove { label: String },

    /// List configured sync targets.
    #[command(alias = "ls")]
    List,
}

// ----- Main -----

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Init tracing — quiet by default unless RUST_LOG is set.
    if !cli.quiet {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("peersync=info")),
            )
            .init();
    }

    let (config_dir, data_dir) = resolve_dirs(cli.config_dir.as_deref(), cli.data_dir.as_deref());

    ensure_dirs(&config_dir, &data_dir)?;

    match cli.command.unwrap_or(Commands::Tui) {
        Commands::Run { .. } => cmd_run(config_dir, data_dir).await,
        Commands::Tui => cmd_tui(config_dir, data_dir).await,
        Commands::Status { conflicts } => cmd_status(config_dir, data_dir, conflicts).await,
        Commands::Log { target, lines } => cmd_log(config_dir, data_dir, target, lines).await,
        Commands::Gc {
            retention_days,
            dry_run,
        } => cmd_gc(config_dir, data_dir, retention_days, dry_run).await,
        Commands::Link { ticket } => cmd_link(config_dir, data_dir, ticket).await,
        Commands::Ticket => cmd_ticket(config_dir, data_dir).await,
        Commands::Config { action } => cmd_config(config_dir, data_dir, action).await,
    }
}

// ----- Helpers -----

/// Resolve config/data dirs with env fallbacks and default paths.
fn resolve_dirs(
    config_override: Option<&std::path::Path>,
    data_override: Option<&std::path::Path>,
) -> (PathBuf, PathBuf) {
    let config_dir = config_override
        .map(PathBuf::from)
        .or_else(|| std::env::var("PEERSYNC_CONFIG_DIR").ok().map(PathBuf::from))
        .unwrap_or_else(|| {
            dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("sendme")
                .join("peersync")
        });

    let data_dir = data_override
        .map(PathBuf::from)
        .or_else(|| std::env::var("PEERSYNC_DATA_DIR").ok().map(PathBuf::from))
        .unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("sendme")
                .join("peersync")
        });

    (config_dir, data_dir)
}

fn ensure_dirs(config_dir: &std::path::Path, data_dir: &std::path::Path) -> Result<()> {
    std::fs::create_dir_all(config_dir).context("creating config dir")?;
    std::fs::create_dir_all(data_dir).context("creating data dir")?;
    Ok(())
}

fn load_config_and_state(
    config_dir: &std::path::Path,
) -> Result<(peersync::config::Config, peersync::state::State)> {
    let config = peersync::config::load_config(Some(config_dir)).unwrap_or_default();
    let state = peersync::state::load_state(&config, Some(config_dir)).unwrap_or_else(|_| {
        peersync::state::State {
            device_name: config.device_name.clone(),
            ..Default::default()
        }
    });
    Ok((config, state))
}

// ----- Commands -----

/// `peersync tui` — launch the interactive terminal UI.
async fn cmd_tui(config_dir: PathBuf, data_dir: PathBuf) -> Result<()> {
    use crossterm::{
        event::{
            DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
        },
        execute,
        terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    };
    use ratatui::backend::CrosstermBackend;
    use ratatui::Terminal;
    use tui::event::AppEvent;

    // Load config and state for the TUI.
    ensure_dirs(&config_dir, &data_dir)?;
    let config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
    let _state = peersync::state::load_state(&config, Some(&config_dir)).unwrap_or_else(|_| {
        peersync::state::State {
            device_name: config.device_name.clone(),
            ..Default::default()
        }
    });

    // Setup terminal in a blocking task.
    let backend = tokio::task::spawn_blocking(|| {
        enable_raw_mode()?;
        let mut stdout = std::io::stdout();
        execute!(
            stdout,
            EnterAlternateScreen,
            EnableMouseCapture,
            EnableBracketedPaste
        )?;
        Ok::<_, anyhow::Error>(CrosstermBackend::new(stdout))
    })
    .await??;

    let (event_handler, event_rx) = EventHandler::new(250);
    let mut app = tui::App::new();

    // Load initial targets from disk.
    app.load_targets(&config);

    // Spawn the blocking TUI event loop.
    tokio::task::spawn_blocking(move || {
        let mut terminal = Terminal::new(backend)?;
        let mut engine_handle: Option<tokio::task::AbortHandle> = None;

        loop {
            tui::ui::render(&mut terminal, &app)?;

            // Process all pending events (non-blocking).
            loop {
                match event_rx.try_recv() {
                    Ok(AppEvent::Paste(text)) => {
                        app.handle_paste(&text);
                    }
                    Ok(AppEvent::Input(key)) => {
                        if tui::event::should_quit(&key) {
                            app.running = false;
                            break;
                        }

                        // Enter key triggers engine start/stop, add target, link, gc.
                        if key.code == crossterm::event::KeyCode::Enter {
                            if app.file_search.is_some() {
                                // Handled in handle_key.
                            } else if app.link_mode {
                                let ticket = app.link_input.trim().to_string();
                                if !ticket.is_empty() {
                                    app.busy = true;
                                    app.message = "Linking to sync doc...".to_string();
                                    let eh = event_handler.clone();
                                    let cd = config_dir.clone();
                                    let dd = data_dir.clone();
                                    let t = ticket.clone();
                                    tokio::spawn(async move {
                                        link_in_background(eh, cd, dd, t).await;
                                    });
                                }
                            } else if app.section == tui::app::Section::Gc {
                                app.busy = true;
                                app.message.clear();
                                let dry_run = app.gc_dry_run;
                                let eh = event_handler.clone();
                                let cd = config_dir.clone();
                                let dd = data_dir.clone();
                                tokio::spawn(async move {
                                    gc_in_background(eh, cd, dd, dry_run).await;
                                });
                            } else if app.section == tui::app::Section::Targets {
                                let path = app.target_input.clone();
                                if !path.is_empty() {
                                    app.add_target(&path);
                                    app.target_input.clear();
                                }
                            } else if app.engine_running {
                                if let Some(handle) = engine_handle.take() {
                                    handle.abort();
                                    app.engine_running = false;
                                    app.message = "Sync engine stopping...".to_string();
                                }
                            } else {
                                app.busy = true;
                                app.message = "Starting sync engine...".to_string();
                                let eh = event_handler.clone();
                                let cd = config_dir.clone();
                                let dd = data_dir.clone();
                                let handle = tokio::spawn(async move {
                                    run_engine_in_background(eh, cd, dd).await;
                                });
                                engine_handle = Some(handle.abort_handle());
                            }
                        } else if key.code == crossterm::event::KeyCode::Char('r')
                            || key.code == crossterm::event::KeyCode::Char('R')
                        {
                            if !app.busy {
                                app.busy = true;
                                app.message.clear();
                                let cd = config_dir.clone();
                                let dd = data_dir.clone();
                                let eh = event_handler.clone();
                                tokio::spawn(async move {
                                    let config = peersync::config::load_config(Some(&cd))
                                        .unwrap_or_default();
                                    let history =
                                        peersync::history::History::open(Some(&cd), Some(&dd))
                                            .unwrap();
                                    let history = Arc::new(history);
                                    let state = peersync::state::load_state(&config, Some(&cd))
                                        .unwrap_or_default();
                                    if let Ok(info) = peersync::status::collect_status(
                                        &config, &state, &history, None,
                                    )
                                    .await
                                    {
                                        eh.emit(AppEvent::StatusUpdated(info));
                                    }
                                    if let Ok(records) = tokio::task::spawn_blocking(move || {
                                        history.query(None, None, None, 100)
                                    })
                                    .await
                                    .unwrap()
                                    {
                                        eh.emit(AppEvent::LogUpdated(records));
                                    }
                                });
                            }
                        } else {
                            app.handle_key(key);
                        }
                    }
                    Ok(AppEvent::Tick) => {}
                    Ok(AppEvent::StatusUpdated(info)) => {
                        app.status = Some(info);
                        app.busy = false;
                    }
                    Ok(AppEvent::LogUpdated(records)) => {
                        app.log = records;
                        app.busy = false;
                    }
                    Ok(AppEvent::EngineStarted) => {
                        app.engine_running = true;
                        app.busy = false;
                    }
                    Ok(AppEvent::EngineStopped) => {
                        app.engine_running = false;
                        app.busy = false;
                    }
                    Ok(AppEvent::Notification(msg)) => {
                        app.message = msg;
                        app.busy = false;
                    }
                    Ok(AppEvent::Ticket(ticket)) => {
                        app.ticket = Some(ticket);
                    }
                    Ok(AppEvent::LinkCompleted { success }) => {
                        app.link_mode = false;
                        app.link_input.clear();
                        app.busy = false;
                        if success && !app.engine_running && !app.link_cancelled {
                            app.busy = true;
                            app.message = "Starting sync engine...".to_string();
                            let eh = event_handler.clone();
                            let cd = config_dir.clone();
                            let dd = data_dir.clone();
                            let handle = tokio::spawn(async move {
                                run_engine_in_background(eh, cd, dd).await;
                            });
                            engine_handle = Some(handle.abort_handle());
                        }
                        app.link_cancelled = false;
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => break,
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        app.running = false;
                        break;
                    }
                }
            }

            if !app.running {
                break;
            }

            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        // Restore terminal.
        disable_raw_mode()?;
        execute!(
            terminal.backend_mut(),
            LeaveAlternateScreen,
            DisableMouseCapture,
            DisableBracketedPaste
        )?;
        terminal.show_cursor()?;

        Ok::<(), anyhow::Error>(())
    })
    .await??;

    Ok(())
}

/// Background: link to an existing sync doc.
async fn link_in_background(
    eh: EventHandler,
    config_dir: PathBuf,
    data_dir: PathBuf,
    ticket: String,
) {
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
        let mut state =
            peersync::state::load_state(&config, Some(&config_dir)).unwrap_or_else(|_| {
                peersync::state::State {
                    device_name: config.device_name.clone(),
                    ..Default::default()
                }
            });

        let network =
            peersync::network::Network::start(Some(&config_dir), Some(&data_dir), &state).await?;

        let inner = async {
            let namespace = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                network.import_ticket(&ticket),
            )
            .await
            .map_err(|_| anyhow::anyhow!("timed out importing ticket"))??;

            state.namespace_id = Some(namespace.to_string());
            let author = network.default_author().await?;
            state.author_id = Some(author.to_string());

            let local_ticket = network.share_doc(namespace).await?;
            state.ticket = Some(local_ticket);
            state.peer_ticket = Some(ticket);

            tokio::task::spawn_blocking(move || {
                peersync::state::save_state(Some(&config_dir), &state)
            })
            .await??;

            anyhow::Ok(namespace.to_string())
        };

        let outcome = inner.await;
        let _ = network.shutdown().await;
        outcome
    })
    .await;

    match result {
        Ok(Ok(ns)) => {
            eh.emit(AppEvent::Notification(format!(
                "Linked to sync doc: {}",
                ns
            )));
            eh.emit(AppEvent::LinkCompleted { success: true });
        }
        _ => {
            let msg = match result {
                Ok(Err(e)) => format!("Failed to link: {}", e),
                _ => "Link timed out".to_string(),
            };
            eh.emit(AppEvent::Notification(msg));
            eh.emit(AppEvent::LinkCompleted { success: false });
        }
    }
}

/// Background: run the sync engine.
async fn run_engine_in_background(eh: EventHandler, config_dir: PathBuf, data_dir: PathBuf) {
    let result = tokio::task::spawn_blocking({
        let cd = config_dir.clone();
        move || {
            let config = peersync::config::load_config(Some(&cd)).unwrap_or_default();
            let state = peersync::state::load_state(&config, Some(&cd)).unwrap_or_default();
            anyhow::Ok((config, state))
        }
    })
    .await;

    let (config, state) = match result {
        Ok(Ok(v)) => v,
        _ => {
            eh.emit(AppEvent::Notification("Failed to load state".to_string()));
            eh.emit(AppEvent::EngineStopped);
            return;
        }
    };

    let (engine_tx, mut engine_rx) = peersync::events::channel();
    let eh_fwd = eh.clone();
    let engine = match peersync::engine::SyncEngine::start(
        config,
        Some(config_dir.clone()),
        Some(data_dir.clone()),
        state,
        Some(engine_tx),
    )
    .await
    {
        Ok(e) => Arc::new(e),
        Err(e) => {
            eh.emit(AppEvent::Notification(format!(
                "Failed to start sync engine: {}",
                e
            )));
            eh.emit(AppEvent::EngineStopped);
            return;
        }
    };

    let engine_fwd = engine.clone();
    tokio::spawn(async move {
        while let Ok(event) = engine_rx.recv().await {
            match event {
                peersync::events::EngineEvent::Warning { message } => {
                    eh_fwd.emit(AppEvent::Notification(message));
                }
                peersync::events::EngineEvent::StatusRefresh => match engine_fwd.status().await {
                    Ok(info) => {
                        eh_fwd.emit(AppEvent::StatusUpdated(info));
                    }
                    Err(e) => {
                        eh_fwd.emit(AppEvent::Notification(format!("Refresh failed: {}", e)));
                    }
                },
                _ => {}
            }
        }
    });

    eh.emit(AppEvent::EngineStarted);

    if let Some(ticket) = engine.ticket() {
        eh.emit(AppEvent::Ticket(ticket));
    }

    match engine.status().await {
        Ok(info) => {
            eh.emit(AppEvent::StatusUpdated(info));
        }
        Err(e) => {
            eh.emit(AppEvent::Notification(format!("Refresh failed: {}", e)));
        }
    }

    if let Err(e) = engine.run().await {
        eh.emit(AppEvent::Notification(format!("Sync engine error: {}", e)));
    }

    eh.emit(AppEvent::EngineStopped);
}

/// Background: run garbage collection.
async fn gc_in_background(eh: EventHandler, config_dir: PathBuf, data_dir: PathBuf, dry_run: bool) {
    let retention_days = 30;
    let config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
    let history = match peersync::history::History::open(Some(&config_dir), Some(&data_dir)) {
        Ok(h) => h,
        Err(e) => {
            eh.emit(AppEvent::Notification(format!("GC failed: {}", e)));
            return;
        }
    };

    match peersync::gc::run_gc(&config, &history, retention_days, dry_run).await {
        Ok(report) => {
            let prefix = if dry_run { "Would remove" } else { "Removed" };
            eh.emit(AppEvent::Notification(format!(
                "{} {} conflict(s), {} tombstone(s), {} history record(s)",
                prefix,
                report.conflict_backups_removed.len(),
                report.tombstones_pruned,
                report.history_records_pruned
            )));
        }
        Err(e) => {
            eh.emit(AppEvent::Notification(format!("GC failed: {}", e)));
        }
    }
}

// ----- Command implementations -----

/// `peersync run` — start the daemon.
async fn cmd_run(config_dir: PathBuf, data_dir: PathBuf) -> Result<()> {
    let (config, state) = load_config_and_state(&config_dir)?;

    eprintln!("PeerSync daemon starting (device: {})", config.device_name);
    eprintln!("  config: {}", config_dir.display());
    eprintln!("  data:   {}", data_dir.display());

    if config.targets.is_empty() {
        eprintln!("  ⚠ no sync targets configured — use `peersync config add <path>`");
    } else {
        for (k, t) in &config.targets {
            eprintln!("  → {}: {}", k, t.src);
        }
    }

    let (events_tx, mut events_rx) = peersync::events::channel();

    let engine = Arc::new(
        peersync::engine::SyncEngine::start(
            config,
            Some(config_dir),
            Some(data_dir),
            state,
            Some(events_tx),
        )
        .await
        .context("starting sync engine")?,
    );

    if let Some(ticket) = engine.ticket() {
        eprintln!("\n  Ticket: {}\n", ticket);
        eprintln!("  Share this ticket with other devices:  peersync link <ticket>");
    }

    // Print events on stdout for users who redirect.
    let _engine_ev = engine.clone();
    tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(peersync::events::EngineEvent::Logged { record }) => {
                    println!(
                        "[{}] {} {}/{}",
                        record.timestamp_ms,
                        record.action.as_str(),
                        record.target_key,
                        record.relative_path
                    );
                }
                Ok(peersync::events::EngineEvent::Warning { message }) => {
                    eprintln!("⚠  {}", message);
                }
                Ok(peersync::events::EngineEvent::StatusRefresh) => {
                    // Quietly refresh; don't flood stdout.
                }
                Ok(peersync::events::EngineEvent::Stopped) => break,
                Err(_) => break,
            }
        }
    });

    // Run until Ctrl+C.
    let engine_run = tokio::spawn(async move {
        if let Err(e) = engine.run().await {
            eprintln!("Engine error: {}", e);
        }
    });

    tokio::signal::ctrl_c().await?;
    eprintln!("\nShutting down...");
    engine_run.abort();

    Ok(())
}

/// `peersync status` — display current sync status.
async fn cmd_status(config_dir: PathBuf, data_dir: PathBuf, show_conflicts: bool) -> Result<()> {
    let (config, state) = load_config_and_state(&config_dir)?;
    let history = peersync::history::History::open(Some(&config_dir), Some(&data_dir))
        .context("opening history")?;
    let history = Arc::new(history);

    let info = peersync::status::collect_status(&config, &state, &history, None)
        .await
        .context("collecting status")?;

    println!("Device:    {}", info.device_name);
    println!(
        "Namespace: {}",
        info.namespace_id.as_deref().unwrap_or("(none)")
    );
    println!(
        "Author:    {}",
        info.author_id.as_deref().unwrap_or("(none)")
    );

    // Peers
    println!("\nPeers:");
    if info.online_peers.is_empty() {
        println!("  (none seen yet)");
    } else {
        for p in &info.online_peers {
            let status = if p.online { "online" } else { "offline" };
            println!("  {}  {}", status, &p.node_id[..p.node_id.len().min(16)]);
        }
    }

    // Targets
    println!("\nTargets:");
    for t in &info.targets {
        let conflict = if t.has_conflicts {
            " ⚠ conflicts!"
        } else {
            ""
        };
        println!(
            "  {:<20} → {} ({} files){}",
            t.key, t.src, t.file_count, conflict
        );
    }

    // Recent events
    println!("\nRecent events:");
    if info.recent_events.is_empty() {
        println!("  (none)");
    } else {
        for e in &info.recent_events {
            println!(
                "  [{}] {} {}/{}",
                e.timestamp_ms, e.action, e.target_key, e.relative_path
            );
        }
    }

    // Conflict files
    if !info.conflict_files.is_empty() {
        println!("\nConflict files:");
        for c in &info.conflict_files {
            println!("  {}: {}", c.target_key, c.relative_path);
        }
    } else if show_conflicts {
        println!("\nConflict files: (none)");
    }

    Ok(())
}

/// `peersync log` — show sync history.
async fn cmd_log(
    config_dir: PathBuf,
    data_dir: PathBuf,
    target: Option<String>,
    lines: usize,
) -> Result<()> {
    let history = peersync::history::History::open(Some(&config_dir), Some(&data_dir))
        .context("opening history")?;

    let records = history
        .query(target.as_deref(), None, None, lines)
        .context("querying history")?;

    if records.is_empty() {
        println!("(no sync events yet)");
        return Ok(());
    }

    println!(
        "{:<15} {:<20} {:<30} {:<20} DETAILS",
        "TIMESTAMP", "ACTION", "TARGET/PATH", "DEVICE"
    );
    for r in &records {
        let details = r.details.as_deref().unwrap_or("");
        println!(
            "{:<15} {:<20} {:<30} {:<20} {}",
            r.timestamp_ms,
            r.action.as_str(),
            format!("{}/{}", r.target_key, r.relative_path),
            r.device_name,
            details,
        );
    }

    Ok(())
}

/// `peersync gc` — run garbage collection.
async fn cmd_gc(
    config_dir: PathBuf,
    data_dir: PathBuf,
    retention_days: u64,
    dry_run: bool,
) -> Result<()> {
    let config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
    let history = peersync::history::History::open(Some(&config_dir), Some(&data_dir))
        .context("opening history")?;

    let mode = if dry_run { "dry-run" } else { "live" };
    eprintln!(
        "Running GC ({} mode, {} day retention)...",
        mode, retention_days
    );

    let report = peersync::gc::run_gc(&config, &history, retention_days, dry_run)
        .await
        .context("running GC")?;

    let prefix = if dry_run { "Would remove" } else { "Removed" };
    println!("{}:", prefix);
    println!(
        "  {} conflict backup(s)",
        report.conflict_backups_removed.len()
    );
    for path in &report.conflict_backups_removed {
        println!("    - {}", path.display());
    }
    println!("  {} tombstone record(s)", report.tombstones_pruned);
    println!("  {} history record(s)", report.history_records_pruned);

    Ok(())
}

/// `peersync link` — join an existing sync doc.
async fn cmd_link(config_dir: PathBuf, data_dir: PathBuf, ticket: String) -> Result<()> {
    let config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
    let mut state = peersync::state::load_state(&config, Some(&config_dir)).unwrap_or_else(|_| {
        peersync::state::State {
            device_name: config.device_name.clone(),
            ..Default::default()
        }
    });

    eprintln!("Linking to sync doc...");
    let network = peersync::network::Network::start(Some(&config_dir), Some(&data_dir), &state)
        .await
        .context("starting network")?;

    let namespace = network.import_ticket(&ticket).await.with_context(|| {
        "Unable to import ticket. Make sure the host device is online \
                 and reachable, or that both devices use the same relay."
            .to_string()
    })?;

    state.namespace_id = Some(namespace.to_string());
    let author = network.default_author().await.context("getting author")?;
    state.author_id = Some(author.to_string());

    // Persist a local share ticket.
    let local_ticket = network.share_doc(namespace).await.context("sharing doc")?;
    state.ticket = Some(local_ticket);
    state.peer_ticket = Some(ticket);

    peersync::state::save_state(Some(&config_dir), &state).context("saving state")?;
    let _ = network.shutdown().await;

    println!("✓ Linked to sync doc: {}", namespace);
    println!(
        "  Your ticket: {}",
        state.ticket.as_deref().unwrap_or("(none)")
    );
    println!("  Run `peersync run` to start syncing.");

    Ok(())
}

/// `peersync ticket` — show the current doc ticket.
async fn cmd_ticket(config_dir: PathBuf, _data_dir: PathBuf) -> Result<()> {
    let config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
    let state = peersync::state::load_state(&config, Some(&config_dir)).unwrap_or_else(|_| {
        peersync::state::State {
            device_name: config.device_name.clone(),
            ..Default::default()
        }
    });

    match state.ticket {
        Some(ticket) => println!("{}", ticket),
        None => {
            anyhow::bail!(
                "No ticket yet. Run `peersync run` to generate one, \
                 or `peersync link <host-ticket>` to join an existing doc."
            );
        }
    }
    Ok(())
}

/// `peersync config` — manage configuration.
async fn cmd_config(config_dir: PathBuf, _data_dir: PathBuf, action: ConfigAction) -> Result<()> {
    let config_path = peersync::config::config_path(Some(&config_dir))?;

    match action {
        ConfigAction::Show => {
            let config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
            println!("Config: {}", config_path.display());
            println!("device_name = \"{}\"", config.device_name);
            println!();
            println!("[sync_targets]");
            if config.targets.is_empty() {
                println!("  (no targets configured)");
            }
            for (key, target) in &config.targets {
                println!("  [sync_targets.{}]", key);
                println!("  src = \"{}\"", target.src);
                if !target.ignore.is_empty() {
                    println!("  ignore = [{}]", target.ignore.join(", "));
                }
            }
        }
        ConfigAction::SetName { name } => {
            let mut config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
            config.device_name = name;
            peersync::config::save_config(Some(&config_dir), &config).context("saving config")?;
            println!("Device name set to: {}", config.device_name);
        }
        ConfigAction::Add { label, path } => {
            let expanded = peersync::config::expand_path(&path).context("expanding path")?;
            let meta =
                std::fs::metadata(&expanded).context(format!("stat {}", expanded.display()))?;
            if !meta.is_dir() && !meta.is_file() {
                anyhow::bail!("Not a file or directory: {}", expanded.display());
            }

            let label = label.unwrap_or_else(|| {
                expanded
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("target")
                    .to_string()
            });

            let mut config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();

            // Ensure label uniqueness.
            let mut final_label = label.clone();
            if config.targets.contains_key(&final_label) {
                for n in 2..=1000 {
                    final_label = format!("{}-{}", label, n);
                    if !config.targets.contains_key(&final_label) {
                        break;
                    }
                }
            }

            config.targets.insert(
                final_label.clone(),
                peersync::config::TargetConfig {
                    src: expanded.to_string_lossy().to_string(),
                    ignore: Vec::new(),
                },
            );
            peersync::config::save_config(Some(&config_dir), &config).context("saving config")?;
            println!("Added target: {} → {}", final_label, expanded.display());
        }
        ConfigAction::Remove { label } => {
            let mut config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
            if config.targets.remove(&label).is_some() {
                peersync::config::save_config(Some(&config_dir), &config)
                    .context("saving config")?;
                println!("Removed target: {}", label);
            } else {
                anyhow::bail!("No target named '{}'", label);
            }
        }
        ConfigAction::List => {
            let config = peersync::config::load_config(Some(&config_dir)).unwrap_or_default();
            if config.targets.is_empty() {
                println!("No sync targets configured.");
                println!("Add one with: peersync config add <path>");
            } else {
                for (key, target) in &config.targets {
                    println!("{:<20} → {}", key, target.src);
                }
            }
        }
    }

    Ok(())
}

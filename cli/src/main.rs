//! Sendme CLI - Send files over the internet using iroh.

use std::{
    collections::{BTreeMap, HashMap},
    io::{self, Write},
    net::{SocketAddrV4, SocketAddrV6},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use clap::{Parser, Subcommand};
use console::style;
use indicatif::{
    HumanBytes, HumanDuration, MultiProgress, ProgressBar, ProgressDrawTarget, ProgressStyle,
};
use tokio::sync::mpsc;

use sendme_lib::{progress::*, types::*};
use fast_qr::QRBuilder;

// Clipboard support (optional)
#[cfg(feature = "clipboard")]
use crossterm::clipboard::CopyToClipboard;

/// Send a file or directory between two machines, using blake3 verified streaming.
#[derive(Parser, Debug)]
#[command(version, about)]
pub struct Args {
    #[clap(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Send a file or directory.
    Send(SendArgsCli),

    /// Receive a file or directory.
    #[clap(visible_alias = "recv")]
    Receive(ReceiveArgsCli),
}

#[derive(Parser, Debug, Clone)]
pub struct CommonArgsCli {
    /// The IPv4 address that magicsocket will listen on.
    #[clap(long, default_value = None)]
    pub magic_ipv4_addr: Option<SocketAddrV4>,

    /// The IPv6 address that magicsocket will listen on.
    #[clap(long, default_value = None)]
    pub magic_ipv6_addr: Option<SocketAddrV6>,

    #[clap(long, default_value_t = Format::Hex)]
    pub format: Format,

    #[clap(short = 'v', long, action = clap::ArgAction::Count)]
    pub verbose: u8,

    /// Suppress progress bars.
    #[clap(long, default_value_t = false)]
    pub no_progress: bool,

    /// The relay URL to use as a home relay.
    #[clap(long, default_value_t = RelayModeOption::Default)]
    pub relay: RelayModeOption,

    #[clap(long)]
    pub show_secret: bool,
}

impl From<CommonArgsCli> for CommonConfig {
    fn from(args: CommonArgsCli) -> Self {
        Self {
            magic_ipv4_addr: args.magic_ipv4_addr,
            magic_ipv6_addr: args.magic_ipv6_addr,
            format: args.format,
            relay: args.relay,
            show_secret: args.show_secret,
            temp_dir: None,
        }
    }
}

#[derive(Parser, Debug, Clone)]
pub struct SendArgsCli {
    /// Path to the file or directory to send.
    #[clap(required = false)]
    pub path: Option<PathBuf>,

    /// What type of ticket to use.
    #[clap(long, default_value_t = AddrInfoOptions::RelayAndAddresses)]
    pub ticket_type: AddrInfoOptions,

    #[clap(flatten)]
    pub common: CommonArgsCli,

    /// Store the receive command in the clipboard.
    #[cfg(feature = "clipboard")]
    #[clap(short = 'c', long)]
    pub clipboard: bool,
}

impl TryFrom<SendArgsCli> for SendArgs {
    type Error = anyhow::Error;

    fn try_from(args: SendArgsCli) -> Result<Self, Self::Error> {
        let path = args
            .path
            .ok_or_else(|| anyhow::anyhow!("Path is required"))?;
        Ok(Self {
            path,
            ticket_type: args.ticket_type,
            common: args.common.into(),
        })
    }
}

#[derive(Parser, Debug, Clone)]
pub struct ReceiveArgsCli {
    /// The ticket to use to connect to the sender.
    #[clap(required = false)]
    pub ticket: Option<sendme_lib::BlobTicket>,

    #[clap(flatten)]
    pub common: CommonArgsCli,
}

impl TryFrom<ReceiveArgsCli> for ReceiveArgs {
    type Error = anyhow::Error;

    fn try_from(args: ReceiveArgsCli) -> Result<Self, Self::Error> {
        let ticket = args
            .ticket
            .ok_or_else(|| anyhow::anyhow!("Ticket is required"))?;
        Ok(Self {
            ticket,
            common: args.common.into(),
            export_dir: None, // CLI uses current directory, no separate export dir
        })
    }
}

fn print_hash(hash: &sendme_lib::Hash, format: Format) -> String {
    match format {
        Format::Hex => hash.to_hex().to_string(),
        Format::Cid => hash.to_string(),
    }
}

/// Read a line from stdin with a prompt.
fn read_line(prompt: &str) -> io::Result<String> {
    print!("{}", prompt);
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    Ok(input.trim().to_string())
}

/// Asynchronously read a line from stdin with Ctrl+C support.
async fn read_line_async(prompt: &str) -> io::Result<Option<String>> {
    let prompt = prompt.to_string();
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            println!("\nExiting...");
            Ok(None)
        }
        result = tokio::task::spawn_blocking(move || read_line(&prompt)) => {
            Ok(Some(result.map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))??))
        }
    }
}

/// Read a file path from stdin with a prompt.
fn read_path(prompt: &str) -> io::Result<PathBuf> {
    loop {
        let input = read_line(prompt)?;
        if input.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Path cannot be empty",
            ));
        }
        let path = PathBuf::from(&input);
        if path.exists() {
            return Ok(path);
        }
        eprintln!("Error: Path '{}' does not exist. Please try again.", input);
    }
}

/// Asynchronously read a file path from stdin with Ctrl+C support.
async fn read_path_async(prompt: &str) -> io::Result<Option<PathBuf>> {
    let prompt = prompt.to_string();
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            println!("\nExiting...");
            Ok(None)
        }
        result = tokio::task::spawn_blocking(move || read_path(&prompt)) => {
            match result.map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))? {
                Ok(p) => Ok(Some(p)),
                Err(e) if e.kind() == io::ErrorKind::InvalidInput => {
                    // Empty input, continue loop
                    Ok(None)
                }
                Err(e) => Err(e),
            }
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let args = match Args::try_parse() {
        Ok(args) => args,
        Err(cause) => {
            cause.exit();
        }
    };

    let res = match args.command {
        Commands::Send(args) => send_cmd(args).await,
        Commands::Receive(args) => receive_cmd(args).await,
    };

    if let Err(e) = &res {
        eprintln!("{e}");
    }

    match res {
        Ok(()) => std::process::exit(0),
        Err(_) => std::process::exit(1),
    }
}

async fn send_cmd(args: SendArgsCli) -> anyhow::Result<()> {
    let show_progress = !args.common.no_progress;
    let verbose = args.common.verbose;
    let format = args.common.format;
    let clipboard = args.clipboard;

    // If no path provided, enter interactive mode
    if args.path.is_none() {
        println!("=== Sendme Interactive Send Mode ===");
        println!("Enter file or directory paths to send, or press Ctrl+C to exit\n");
        loop {
            match read_path_async("Enter path to send> ").await? {
                Some(path) => {
                    let mut send_args = args.clone();
                    send_args.path = Some(path.clone());

                    if let Err(e) =
                        send_single_file(send_args, show_progress, verbose, format, clipboard).await
                    {
                        eprintln!("Error sending file: {e}");
                    }

                    println!();
                }
                None => break, // Ctrl+C pressed
            }
        }
        Ok(())
    } else {
        // Single send mode
        send_single_file(args, show_progress, verbose, format, clipboard).await
    }
}

async fn send_single_file(
    args: SendArgsCli,
    show_progress: bool,
    verbose: u8,
    format: Format,
    clipboard: bool,
) -> anyhow::Result<()> {
    let path = args.path.clone().unwrap();
    let lib_args: SendArgs = args.try_into()?;

    let mp = Arc::new(MultiProgress::new());
    let draw_target = if show_progress {
        ProgressDrawTarget::stderr()
    } else {
        ProgressDrawTarget::hidden()
    };
    mp.set_draw_target(draw_target);

    let (progress_tx, progress_rx) = mpsc::channel(32);

    // Spawn progress handler
    let progress_mp = mp.clone();
    tokio::spawn(async move {
        handle_progress_events(progress_mp, progress_rx).await;
    });

    let result = sendme_lib::send_with_progress(lib_args, progress_tx).await?;

    let entry_type = if path.is_file() { "file" } else { "directory" };
    println!(
        "\n✓ Imported {} {}, {}, hash {}",
        entry_type,
        path.display(),
        HumanBytes(result.total_size),
        print_hash(&result.hash, format),
    );

    if verbose > 1 {
        for (name, hash) in result.collection.iter() {
            println!("    {} {name}", print_hash(hash, format));
        }
        println!(
            "{}s, {}/s",
            result.import_duration.as_secs_f64(),
            HumanBytes(
                ((result.total_size as f64) / result.import_duration.as_secs_f64()).floor() as u64
            )
        );
    }

    println!("To get this data, use:");
    println!("  sendme receive {}", result.ticket);

    // Generate and display QR code for the ticket
    print_qr_code(&result.ticket.to_string());

    #[cfg(feature = "clipboard")]
    if clipboard {
        add_to_clipboard(&result.ticket);
    }

    println!("\nWaiting for incoming connections... (Press Ctrl+C to stop serving)");

    // Keep the send task alive
    tokio::signal::ctrl_c().await?;

    Ok(())
}

async fn receive_cmd(args: ReceiveArgsCli) -> anyhow::Result<()> {
    let show_progress = !args.common.no_progress;
    let verbose = args.common.verbose;

    // If no ticket provided, enter interactive mode
    if args.ticket.is_none() {
        println!("=== Sendme Interactive Receive Mode ===");
        println!("Enter tickets to receive files, or press Ctrl+C to exit\n");
        loop {
            match read_line_async("Enter ticket> ").await? {
                Some(ticket_str) => {
                    if ticket_str.is_empty() {
                        eprintln!("Ticket cannot be empty. Please try again.");
                        continue;
                    }

                    let ticket = match ticket_str.parse::<sendme_lib::BlobTicket>() {
                        Ok(t) => t,
                        Err(e) => {
                            eprintln!("Error parsing ticket: {e}. Please try again.");
                            continue;
                        }
                    };

                    let mut receive_args = args.clone();
                    receive_args.ticket = Some(ticket);

                    if let Err(e) = receive_single_file(receive_args, show_progress, verbose).await
                    {
                        eprintln!("Error receiving file: {e}");
                    }

                    println!();
                }
                None => break, // Ctrl+C pressed
            }
        }
        Ok(())
    } else {
        // Single receive mode
        receive_single_file(args, show_progress, verbose).await
    }
}

async fn receive_single_file(
    args: ReceiveArgsCli,
    show_progress: bool,
    verbose: u8,
) -> anyhow::Result<()> {
    let lib_args: ReceiveArgs = args.try_into()?;

    let mp = Arc::new(MultiProgress::new());
    let draw_target = if show_progress {
        ProgressDrawTarget::stderr()
    } else {
        ProgressDrawTarget::hidden()
    };
    mp.set_draw_target(draw_target);

    let (progress_tx, progress_rx) = mpsc::channel(32);

    // Spawn progress handler
    let progress_mp = mp.clone();
    let progress_handle = tokio::spawn(async move {
        handle_progress_events(progress_mp, progress_rx).await;
    });

    let result = sendme_lib::receive_with_progress(lib_args, progress_tx).await?;

    // Wait for progress handler to finish
    progress_handle.await.ok();

    if let Some((name, _)) = result.collection.iter().next() {
        if let Some(first) = name.split('/').next() {
            println!("✓ Exported to {first}");
        }
    }

    if verbose > 0 {
        println!(
            "Downloaded {} files, {}. Took {} ({}/s)",
            result.total_files,
            HumanBytes(result.payload_size),
            HumanDuration(result.stats.elapsed),
            HumanBytes(
                ((result.stats.total_bytes_read() as f64) / result.stats.elapsed.as_secs_f64())
                    as u64
            )
        );
    }

    Ok(())
}

/// Handle progress events from the library and update progress bars.
async fn handle_progress_events(mp: Arc<MultiProgress>, mut recv: mpsc::Receiver<ProgressEvent>) {
    use std::collections::HashMap;

    let mut import_bars: HashMap<String, ProgressBar> = HashMap::new();
    let mut export_bars: HashMap<String, ProgressBar> = HashMap::new();
    let mut download_bar: Option<ProgressBar> = None;
    let connections: std::sync::Mutex<BTreeMap<u64, ConnectionProgress>> =
        std::sync::Mutex::new(BTreeMap::new());

    while let Some(event) = recv.recv().await {
        match event {
            ProgressEvent::Import(name, progress) => {
                handle_import_progress(&mp, &mut import_bars, name, progress);
            }
            ProgressEvent::Export(name, progress) => {
                handle_export_progress(&mp, &mut export_bars, name, progress);
            }
            ProgressEvent::Download(progress) => {
                handle_download_progress(&mp, &mut download_bar, progress);
            }
            ProgressEvent::Connection(status) => {
                handle_connection_status(&mp, &mut connections.lock().unwrap(), status);
            }
        }
    }

    // Clean up all progress bars
    for bar in import_bars.values() {
        bar.finish_and_clear();
        mp.remove(bar);
    }
    for bar in export_bars.values() {
        bar.finish_and_clear();
        mp.remove(bar);
    }
    if let Some(bar) = download_bar {
        bar.finish_and_clear();
        mp.remove(&bar);
    }
}

fn handle_import_progress(
    mp: &MultiProgress,
    bars: &mut HashMap<String, ProgressBar>,
    _name: String,
    progress: ImportProgress,
) {
    match progress {
        ImportProgress::Started { total_files } => {
            let bar = mp.add(make_overall_progress("Importing"));
            bar.set_length(total_files as u64);
            bars.insert("".to_string(), bar);
        }
        ImportProgress::FileStarted { name, size } => {
            let bar = mp.add(make_file_progress());
            bar.set_length(size);
            bar.set_message(format!("copying {name}"));
            bars.insert(name.clone(), bar);
        }
        ImportProgress::FileProgress { name, offset } => {
            if let Some(bar) = bars.get(&name) {
                bar.set_position(offset);
            }
        }
        ImportProgress::FileCompleted { name } => {
            if let Some(bar) = bars.remove(&name) {
                bar.finish_and_clear();
                mp.remove(&bar);
            }
        }
        ImportProgress::Completed { .. } => {
            if let Some(bar) = bars.remove("") {
                bar.finish_and_clear();
                mp.remove(&bar);
            }
        }
    }
}

fn handle_export_progress(
    mp: &MultiProgress,
    bars: &mut HashMap<String, ProgressBar>,
    _name: String,
    progress: ExportProgress,
) {
    match progress {
        ExportProgress::Started { total_files } => {
            let bar = mp.add(make_overall_progress("Exporting"));
            bar.set_length(total_files as u64);
            bars.insert("".to_string(), bar);
        }
        ExportProgress::FileStarted { name, size } => {
            let bar = mp.add(make_file_progress());
            bar.set_length(size);
            bar.set_message(format!("exporting {name}"));
            bars.insert(name.clone(), bar);
        }
        ExportProgress::FileProgress { name, offset } => {
            if let Some(bar) = bars.get(&name) {
                bar.set_position(offset);
            }
        }
        ExportProgress::FileCompleted { name } => {
            if let Some(bar) = bars.remove(&name) {
                bar.finish_and_clear();
                mp.remove(&bar);
            }
        }
        ExportProgress::Completed => {
            if let Some(bar) = bars.remove("") {
                bar.finish_and_clear();
                mp.remove(&bar);
            }
        }
    }
}

fn handle_download_progress(
    mp: &MultiProgress,
    bar: &mut Option<ProgressBar>,
    progress: DownloadProgress,
) {
    match progress {
        DownloadProgress::Connecting => {
            let pb = mp.add(make_connect_progress());
            *bar = Some(pb);
        }
        DownloadProgress::GettingSizes => {
            if let Some(b) = bar {
                b.finish_and_clear();
                mp.remove(b);
            }
            let pb = mp.add(make_get_sizes_progress());
            *bar = Some(pb);
        }
        DownloadProgress::Metadata {
            total_size,
            file_count,
            names,
        } => {
            if let Some(b) = bar {
                b.finish_and_clear();
                mp.remove(b);
            }
            *bar = None; // Reset bar so Downloading phase can create a new one

            // Print metadata information
            println!("\n📦 Transfer Information:");
            println!("   Files: {}", file_count);
            println!("   Total size: {}", HumanBytes(total_size));
            if !names.is_empty() {
                // Get the root name (first path component)
                // Handle both forward and backward slashes for cross-platform compatibility
                if let Some(first_name) = names.first() {
                    let root = first_name
                        .split(|c| c == '/' || c == '\\')
                        .next()
                        .unwrap_or(first_name);
                    println!("   Name: {}", root);
                }
                if names.len() <= 5 {
                    println!("   Contents:");
                    for name in &names {
                        println!("     - {}", name);
                    }
                } else {
                    println!("   Contents (first 5 of {} files):", names.len());
                    for name in names.iter().take(5) {
                        println!("     - {}", name);
                    }
                }
            }
            println!();
        }
        DownloadProgress::Downloading { offset, total } => {
            // Switch to block progress bar if not already using it
            // Check if we need to create or replace the progress bar
            let needs_new_bar = match bar.as_ref() {
                None => true,
                Some(b) => {
                    // Replace if the bar is not our percentage-based bar (length != Some(100))
                    b.length() != Some(100)
                }
            };

            if needs_new_bar {
                if let Some(b) = bar.take() {
                    b.finish_and_clear();
                    mp.remove(&b);
                }
                let pb = mp.add(make_block_progress());
                pb.set_length(100); // Set to 100 for percentage-based progress
                *bar = Some(pb);
            }

            if let Some(b) = bar.as_ref() {
                let percent = (offset as f64 / total as f64 * 100.0) as u64;
                b.set_position(percent);
            }
        }
        DownloadProgress::Completed => {
            if let Some(b) = bar {
                b.set_position(100); // Ensure it shows 100%
                b.finish_with_message("✓ Download complete");
                mp.remove(&b);
                *bar = None;
            }
        }
    }
}

fn handle_connection_status(
    mp: &MultiProgress,
    connections: &mut BTreeMap<u64, ConnectionProgress>,
    status: ConnectionStatus,
) {
    match status {
        ConnectionStatus::ClientConnected {
            endpoint_id,
            connection_id,
        } => {
            connections.insert(
                connection_id,
                ConnectionProgress {
                    endpoint_id,
                    requests: BTreeMap::new(),
                },
            );
        }
        ConnectionStatus::ConnectionClosed { connection_id } => {
            if let Some(conn) = connections.remove(&connection_id) {
                for (_, pb) in conn.requests {
                    pb.finish_and_clear();
                    mp.remove(&pb);
                }
            }
        }
        ConnectionStatus::RequestStarted {
            connection_id,
            request_id,
            hash,
            size,
        } => {
            if let Some(conn) = connections.get_mut(&connection_id) {
                let pb = mp.add(make_transfer_progress());
                pb.set_length(size);
                pb.set_message(format!("{} # {}", connection_id, hash.to_hex().to_string()));
                conn.requests.insert(request_id, pb);
            }
        }
        ConnectionStatus::RequestProgress {
            connection_id,
            request_id,
            offset,
        } => {
            if let Some(conn) = connections.get(&connection_id) {
                if let Some(pb) = conn.requests.get(&request_id) {
                    pb.set_position(offset);
                }
            }
        }
        ConnectionStatus::RequestCompleted {
            connection_id,
            request_id,
        } => {
            if let Some(conn) = connections.get_mut(&connection_id) {
                if let Some(pb) = conn.requests.remove(&request_id) {
                    pb.finish_and_clear();
                    mp.remove(&pb);
                }
            }
        }
    }
}

struct ConnectionProgress {
    #[allow(dead_code)]
    endpoint_id: String,
    requests: BTreeMap<u64, ProgressBar>,
}

// Progress bar styles
fn make_overall_progress(prefix: &str) -> ProgressBar {
    let pb = ProgressBar::hidden();
    pb.enable_steady_tick(Duration::from_millis(250));
    pb.set_style(
        ProgressStyle::with_template(
            &format!(
                "{{prefix}}{{spinner:.green}} {} ... [{{elapsed_precise}}] [{{wide_bar:.cyan/blue}}] {{pos}}/{{len}}",
                prefix
            ),
        )
        .unwrap()
        .progress_chars("#>-"),
    );
    pb
}

fn make_file_progress() -> ProgressBar {
    let pb = ProgressBar::hidden();
    pb.enable_steady_tick(Duration::from_millis(100));
    pb.set_style(
        ProgressStyle::with_template(
            "{msg}{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {bytes}/{total_bytes}",
        )
        .unwrap()
        .progress_chars("#>-"),
    );
    pb
}

fn make_connect_progress() -> ProgressBar {
    let pb = ProgressBar::hidden();
    pb.set_style(
        ProgressStyle::with_template("{prefix}{spinner:.green} Connecting ... [{elapsed_precise}]")
            .unwrap(),
    );
    pb.set_prefix(format!("{} ", style("[1/4]").bold().dim()));
    pb.enable_steady_tick(Duration::from_millis(250));
    pb
}

fn make_get_sizes_progress() -> ProgressBar {
    let pb = ProgressBar::hidden();
    pb.set_style(
        ProgressStyle::with_template(
            "{prefix}{spinner:.green} Getting sizes... [{elapsed_precise}]",
        )
        .unwrap(),
    );
    pb.set_prefix(format!("{} ", style("[2/4]").bold().dim()));
    pb.enable_steady_tick(Duration::from_millis(250));
    pb
}

fn make_transfer_progress() -> ProgressBar {
    let pb = ProgressBar::hidden();
    pb.enable_steady_tick(Duration::from_millis(250));
    pb.set_style(
        ProgressStyle::with_template(
            "{msg}{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {bytes}/{total_bytes}",
        )
        .unwrap()
        .progress_chars("#>-"),
    );
    pb
}

/// Block-based progress bar showing 10 blocks (each = 10%)
/// Visual: [████████░░] 80%
fn make_block_progress() -> ProgressBar {
    let pb = ProgressBar::hidden();
    pb.enable_steady_tick(Duration::from_millis(250));

    // Custom template that shows 10 blocks
    pb.set_style(
        ProgressStyle::with_template(
            "{prefix}{spinner:.green} Downloading [{wide_bar}] {percent}%",
        )
        .unwrap()
        .progress_chars("█░"), // Use █ for filled, ░ for empty
    );
    pb.set_prefix(format!("{} ", style("[3/4]").bold().dim()));
    pb
}

// Clipboard functions (only when feature is enabled)
#[cfg(feature = "clipboard")]
fn add_to_clipboard(ticket: &sendme_lib::BlobTicket) {
    use crossterm::execute;
    use std::io::stdout;

    execute!(
        stdout(),
        CopyToClipboard::to_clipboard_from(format!("sendme receive {ticket}"))
    )
    .unwrap_or_else(|e| eprintln!("Failed to copy to clipboard: {e}"));
}

/// Print a QR code for the given data
fn print_qr_code(data: &str) {
    println!("\n{}", style("QR Code:").bold().dim());

    match QRBuilder::new(data)
        .ecl(fast_qr::ECL::H) // High error correction for better scanning
        .build()
    {
        Ok(qr) => {
            // Convert to string and print
            let str_qr = qr.to_str();
            println!("{}", str_qr);
        }
        Err(e) => {
            eprintln!("Failed to generate QR code: {}", e);
        }
    }
}

//! Send functionality - hosting files for transfer.

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Instant,
};

use iroh::{discovery::pkarr::PkarrPublisher, Endpoint, RelayMode};
use iroh_blobs::{
    provider::events::{ConnectMode, EventMask, EventSender, ProviderMessage, RequestMode},
    store::fs::FsStore,
    BlobFormat, BlobsProtocol,
};

use n0_future::StreamExt;
use tokio::select;

use crate::{apply_options, get_or_create_secret, progress::*, types::*, SendArgs, SendResult};

use rand::Rng;

/// Send a file or directory.
///
/// This function creates a temporary iroh node that serves the content in the
/// given file or directory. It returns a ticket that can be used to get the data.
///
/// The provider will run until it is terminated. On termination, it will delete
/// the temporary directory.
pub async fn send(args: SendArgs) -> anyhow::Result<SendResult> {
    send_internal(args, None).await
}

/// Send a file or directory with progress reporting.
pub async fn send_with_progress(
    args: SendArgs,
    progress_tx: ProgressSenderTx,
) -> anyhow::Result<SendResult> {
    send_internal(args, Some(progress_tx)).await
}

async fn send_internal(
    args: SendArgs,
    progress_tx: Option<ProgressSenderTx>,
) -> anyhow::Result<SendResult> {
    let secret_key = get_or_create_secret(args.common.show_secret)?;
    let relay_mode: RelayMode = args.common.relay.into();

    let mut builder = Endpoint::builder()
        .alpns(vec![iroh_blobs::protocol::ALPN.to_vec()])
        .secret_key(secret_key)
        .relay_mode(relay_mode.clone());

    if args.ticket_type == AddrInfoOptions::Id {
        builder = builder.discovery(PkarrPublisher::n0_dns());
    }

    if let Some(addr) = args.common.magic_ipv4_addr {
        builder = builder.bind_addr_v4(addr);
    }
    if let Some(addr) = args.common.magic_ipv6_addr {
        builder = builder.bind_addr_v6(addr);
    }

    // Create temporary directory for blob storage
    let suffix = rand::rng().random::<[u8; 16]>();

    // Use custom temp_dir if provided (required for macOS sandbox), otherwise use cwd
    let temp_dir_for_borrow = args
        .common
        .temp_dir
        .as_ref()
        .map(std::path::PathBuf::as_path);
    let base_dir = match temp_dir_for_borrow {
        Some(path) => path,
        None => {
            // Store cwd to avoid temporary value issue
            &*std::path::PathBuf::from(std::env::current_dir()?)
        }
    };

    let blobs_data_dir = base_dir.join(format!(
        ".sendme-send-{}",
        data_encoding::HEXLOWER.encode(&suffix)
    ));

    if blobs_data_dir.exists() {
        anyhow::bail!(
            "can not share twice from the same directory: {}",
            base_dir.display()
        );
    }

    // Check if trying to share from current directory
    if args.common.temp_dir.is_none() {
        let cwd = std::env::current_dir()?;
        if cwd.join(&args.path) == cwd {
            anyhow::bail!("can not share from the current directory");
        }
    }

    let path = args.path;
    let blobs_data_dir2 = blobs_data_dir.clone();
    let _ticket_type = args.ticket_type;
    let progress_tx2 = progress_tx.clone();

    let setup = async move {
        let t0 = Instant::now();
        tokio::fs::create_dir_all(&blobs_data_dir2).await?;

        let endpoint = builder.bind().await?;
        let store = FsStore::load(&blobs_data_dir2).await?;

        let (event_tx, mut event_rx) = tokio::sync::mpsc::channel(32);
        let blobs = BlobsProtocol::new(
            &store,
            Some(EventSender::new(
                event_tx,
                EventMask {
                    connected: ConnectMode::Notify,
                    get: RequestMode::NotifyLog,
                    ..EventMask::DEFAULT
                },
            )),
        );

        // Spawn progress handler if channel provided
        if let Some(ref tx) = progress_tx2 {
            tokio::task::spawn(handle_provider_progress(tx.clone(), event_rx));
        } else {
            // Still consume the events to prevent blocking
            tokio::spawn(async move { while event_rx.recv().await.is_some() {} });
        }

        let import_result = crate::import::import(path, &store, progress_tx2).await?;
        let dt = t0.elapsed();

        let router = iroh::protocol::Router::builder(endpoint)
            .accept(iroh_blobs::ALPN, blobs.clone())
            .spawn();

        anyhow::Ok((router, import_result, dt))
    };

    let (router, (hash, size, collection), dt) = select! {
        x = setup => x?,
        _ = tokio::signal::ctrl_c() => {
            std::process::exit(130);
        }
    };

    // Make a ticket
    let mut addr = router.endpoint().addr();
    apply_options(&mut addr, args.ticket_type);
    let ticket = iroh_blobs::ticket::BlobTicket::new(addr, hash, BlobFormat::HashSeq);

    // Spawn a task to keep the router alive for connections
    tokio::spawn(async move {
        let _router = router;
        std::future::pending::<()>().await;
    });

    Ok(SendResult {
        hash,
        collection,
        total_size: size,
        import_duration: dt,
        ticket,
    })
}

/// Handle provider progress events and forward them to the progress channel.
async fn handle_provider_progress(
    progress_tx: ProgressSenderTx,
    mut recv: tokio::sync::mpsc::Receiver<ProviderMessage>,
) -> anyhow::Result<()> {
    let connections = Arc::new(Mutex::new(BTreeMap::new()));
    let mut tasks = n0_future::FuturesUnordered::new();

    loop {
        tokio::select! {
            biased;
            item = recv.recv() => {
                let Some(item) = item else {
                    break;
                };

                match item {
                    ProviderMessage::ClientConnectedNotify(msg) => {
                        let endpoint_id = msg
                            .endpoint_id
                            .map(|id| id.fmt_short().to_string())
                            .unwrap_or_else(|| "?".to_string());
                        let connection_id = msg.connection_id;
                        connections.lock().unwrap().insert(
                            connection_id,
                            ConnectionInfo {
                                requests: BTreeMap::new(),
                                endpoint_id: endpoint_id.clone(),
                            },
                        );
                        let _ = progress_tx
                            .send(ProgressEvent::Connection(ConnectionStatus::ClientConnected {
                                endpoint_id,
                                connection_id,
                            }))
                            .await;
                    }
                    ProviderMessage::ConnectionClosed(msg) => {
                        if connections.lock().unwrap().remove(&msg.connection_id).is_some() {
                            let _ = progress_tx
                                .send(ProgressEvent::Connection(ConnectionStatus::ConnectionClosed {
                                    connection_id: msg.connection_id,
                                }))
                                .await;
                        }
                    }
                    ProviderMessage::GetRequestReceivedNotify(msg) => {
                        let request_id = msg.request_id;
                        let connection_id = msg.connection_id;
                        let connections = connections.clone();
                        let progress_tx = progress_tx.clone();
                        tasks.push(tokio::task::spawn(async move {
                            let mut rx = msg.rx;
                            while let Ok(Some(msg)) = rx.recv().await {
                                match msg {
                                    iroh_blobs::provider::events::RequestUpdate::Started(msg) => {
                                        let _ = progress_tx
                                            .send(ProgressEvent::Connection(ConnectionStatus::RequestStarted {
                                                connection_id,
                                                request_id,
                                                hash: msg.hash,
                                                size: msg.size,
                                            }))
                                            .await;
                                    }
                                    iroh_blobs::provider::events::RequestUpdate::Progress(msg) => {
                                        let _ = progress_tx
                                            .send(ProgressEvent::Connection(ConnectionStatus::RequestProgress {
                                                connection_id,
                                                request_id,
                                                offset: msg.end_offset,
                                            }))
                                            .await;
                                    }
                                    iroh_blobs::provider::events::RequestUpdate::Completed(_) => {
                                        if let Some(conn) = connections.lock().unwrap().get_mut(&connection_id) {
                                            let _ = conn.requests.remove(&request_id);
                                        }
                                        let _ = progress_tx
                                            .send(ProgressEvent::Connection(ConnectionStatus::RequestCompleted {
                                                connection_id,
                                                request_id,
                                            }))
                                            .await;
                                        break;
                                    }
                                    iroh_blobs::provider::events::RequestUpdate::Aborted(_) => {
                                        if let Some(conn) = connections.lock().unwrap().get_mut(&connection_id) {
                                            let _ = conn.requests.remove(&request_id);
                                        }
                                        break;
                                    }
                                }
                            }
                        }));
                    }
                    _ => {}
                }
            }
            Some(_) = tasks.next(), if !tasks.is_empty() => {}
        }
    }
    while tasks.next().await.is_some() {}
    Ok(())
}

#[derive(Debug)]
struct ConnectionInfo {
    #[allow(dead_code)]
    endpoint_id: String,
    requests: BTreeMap<u64, ()>,
}

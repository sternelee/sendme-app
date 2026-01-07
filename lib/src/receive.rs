//! Receive functionality - downloading files.

use iroh::{discovery::dns::DnsDiscovery, Endpoint};
use iroh_blobs::{
    format::collection::Collection,
    get::{request::get_hash_seq_and_sizes, GetError, Stats},
    store::fs::FsStore,
};

use n0_future::StreamExt;

use crate::{export, get_or_create_secret, progress::*, ReceiveArgs, ReceiveResult};

/// Receive a file or directory.
///
/// This will download the data and create a file or directory named like the source
/// in the **current directory**.
///
/// It will create a temporary directory in the current directory, download the data
/// (single file or directory), and only then move these files to the target directory.
///
/// On completion, it will delete the temp directory.
pub async fn receive(args: ReceiveArgs) -> anyhow::Result<ReceiveResult> {
    receive_internal(args, None).await
}

/// Receive a file or directory with progress reporting.
pub async fn receive_with_progress(
    args: ReceiveArgs,
    progress_tx: ProgressSenderTx,
) -> anyhow::Result<ReceiveResult> {
    receive_internal(args, Some(progress_tx)).await
}

async fn receive_internal(
    args: ReceiveArgs,
    progress_tx: Option<ProgressSenderTx>,
) -> anyhow::Result<ReceiveResult> {
    let ticket = args.ticket;
    let addr = ticket.addr().clone();
    let secret_key = get_or_create_secret(args.common.show_secret)?;
    let mut builder = Endpoint::builder()
        .alpns(vec![])
        .secret_key(secret_key)
        .relay_mode(args.common.relay.into());

    if ticket.addr().relay_urls().next().is_none() && ticket.addr().ip_addrs().next().is_none() {
        builder = builder.discovery(DnsDiscovery::n0_dns());
    }

    if let Some(addr) = args.common.magic_ipv4_addr {
        builder = builder.bind_addr_v4(addr);
    }
    if let Some(addr) = args.common.magic_ipv6_addr {
        builder = builder.bind_addr_v6(addr);
    }

    let endpoint = builder.bind().await?;
    let dir_name = format!(".sendme-recv-{}", ticket.hash().to_hex());
    let iroh_data_dir = std::env::current_dir()?.join(dir_name);
    let db = FsStore::load(&iroh_data_dir).await?;

    let hash_and_format = ticket.hash_and_format();
    let local = db.remote().local(hash_and_format).await?;

    let (stats, total_files, payload_size, metadata_collection) = if !local.is_complete() {
        if let Some(ref tx) = progress_tx {
            let _ = tx
                .send(ProgressEvent::Download(DownloadProgress::Connecting))
                .await;
        }

        let connection = endpoint.connect(addr, iroh_blobs::protocol::ALPN).await?;

        if let Some(ref tx) = progress_tx {
            let _ = tx
                .send(ProgressEvent::Download(DownloadProgress::GettingSizes))
                .await;
        }

        let (hash_seq, sizes) =
            get_hash_seq_and_sizes(&connection, &hash_and_format.hash, 1024 * 1024 * 32, None)
                .await
                .map_err(|e| show_get_error(e))?;

        let total_size = sizes.iter().copied().sum::<u64>();
        let payload_size = sizes.iter().skip(2).copied().sum::<u64>();
        let total_files = (sizes.len().saturating_sub(1)) as u64;

        if let Some(ref tx) = progress_tx {
            let _ = tx
                .send(ProgressEvent::Download(DownloadProgress::Downloading {
                    offset: 0,
                    total: total_size,
                }))
                .await;
        }

        let local_size = local.local_bytes();
        let get = db.remote().execute_get(connection, local.missing());
        let mut stream = get.stream();
        let mut stats = Stats::default();
        let mut metadata_sent = false;
        let mut metadata_collection: Option<Collection> = None;
        let mut progress_count = 0u32;

        while let Some(item) = stream.next().await {
            match item {
                iroh_blobs::api::remote::GetProgressItem::Progress(offset) => {
                    // Try to load collection metadata as soon as it's available
                    // Try on first event and then every 10th event thereafter (events 1, 11, 21...) to avoid excessive load attempts
                    if !metadata_sent {
                        progress_count += 1;
                        if (progress_count - 1) % 10 == 0 {
                            if let Ok(collection) =
                                Collection::load(hash_and_format.hash, db.as_ref()).await
                            {
                                // Calculate actual payload size from collection files
                                let mut actual_payload_size = 0u64;
                                for (name, file_hash) in collection.iter() {
                                    // Find the size for this file hash in the hash_seq
                                    if let Some(idx) = hash_seq.iter().position(|h| h == *file_hash)
                                    {
                                        if idx < sizes.len() {
                                            actual_payload_size += sizes[idx];
                                            tracing::debug!(
                                                "File {}: hash at index {}, size {}",
                                                name,
                                                idx,
                                                sizes[idx]
                                            );
                                        }
                                    } else {
                                        tracing::warn!("File {} hash not found in hash_seq", name);
                                    }
                                }

                                tracing::info!(
                                    "Metadata: {} files, total size: {}",
                                    collection.iter().count(),
                                    actual_payload_size
                                );

                                let names: Vec<String> = collection
                                    .iter()
                                    .map(|(name, _hash)| name.to_string())
                                    .collect();

                                if let Some(ref tx) = progress_tx {
                                    let _ = tx
                                        .send(ProgressEvent::Download(DownloadProgress::Metadata {
                                            total_size: actual_payload_size,
                                            file_count: total_files,
                                            names,
                                        }))
                                        .await;
                                }
                                metadata_sent = true;
                                metadata_collection = Some(collection);
                            }
                        }
                    }

                    if let Some(ref tx) = progress_tx {
                        let _ = tx
                            .send(ProgressEvent::Download(DownloadProgress::Downloading {
                                offset: local_size + offset,
                                total: total_size,
                            }))
                            .await;
                    }
                }
                iroh_blobs::api::remote::GetProgressItem::Done(value) => {
                    stats = value;
                    break;
                }
                iroh_blobs::api::remote::GetProgressItem::Error(cause) => {
                    anyhow::bail!(show_get_error(cause));
                }
            }
        }

        (stats, total_files, payload_size, metadata_collection)
    } else {
        // Collection already cached locally
        let total_files = local.children().unwrap() - 1;
        // Use local_bytes as an approximation for total size (includes some metadata overhead)
        let payload_bytes = local.local_bytes();

        // Load collection and emit metadata event
        let collection = Collection::load(hash_and_format.hash, db.as_ref()).await?;
        let names: Vec<String> = collection
            .iter()
            .map(|(name, _hash)| name.to_string())
            .collect();

        if let Some(ref tx) = progress_tx {
            let _ = tx
                .send(ProgressEvent::Download(DownloadProgress::Metadata {
                    total_size: payload_bytes,
                    file_count: total_files,
                    names,
                }))
                .await;
        }

        (
            Stats::default(),
            total_files,
            payload_bytes,
            Some(collection),
        )
    };

    // Use cached collection if available, otherwise load it
    let collection = match metadata_collection {
        Some(col) => col,
        None => Collection::load(hash_and_format.hash, db.as_ref()).await?,
    };
    export::export(&db, collection.clone(), progress_tx.clone()).await?;

    if let Some(ref tx) = progress_tx {
        let _ = tx
            .send(ProgressEvent::Download(DownloadProgress::Completed))
            .await;
    }

    // Clean up temp directory
    tokio::fs::remove_dir_all(iroh_data_dir).await?;

    Ok(ReceiveResult {
        collection,
        total_files,
        payload_size,
        stats,
    })
}

/// Show get error with context.
fn show_get_error(e: GetError) -> GetError {
    match &e {
        GetError::InitialNext { .. } => {
            tracing::error!("initial connection error: {:?}", e);
        }
        GetError::ConnectedNext { .. } => {
            tracing::error!("connected error: {:?}", e);
        }
        GetError::AtBlobHeaderNext { .. } => {
            tracing::error!("reading blob header error: {:?}", e);
        }
        GetError::Decode { .. } => {
            tracing::error!("decoding error: {:?}", e);
        }
        GetError::IrpcSend { .. } => {
            tracing::error!("error sending over irpc: {:?}", e);
        }
        GetError::AtClosingNext { .. } => {
            tracing::error!("error at closing: {:?}", e);
        }
        GetError::BadRequest { .. } => {
            tracing::error!("bad request");
        }
        GetError::LocalFailure { .. } => {
            tracing::error!("local failure: {:?}", e);
        }
    }
    e
}

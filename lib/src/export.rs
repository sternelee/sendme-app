//! File export functionality.

use iroh_blobs::{format::collection::Collection, store::fs::FsStore};

use n0_future::StreamExt;

use crate::{get_export_path, progress::ProgressSenderTx};

/// Export a collection to the current directory.
pub async fn export(
    db: &FsStore,
    collection: Collection,
    progress_tx: Option<ProgressSenderTx>,
) -> anyhow::Result<()> {
    let root = std::env::current_dir()?;

    if let Some(ref tx) = progress_tx {
        let _ = tx
            .send(crate::progress::ProgressEvent::Export(
                "".to_string(),
                crate::progress::ExportProgress::Started {
                    total_files: collection.len(),
                },
            ))
            .await;
    }

    for (_i, (name, hash)) in collection.iter().enumerate() {
        let target = get_export_path(&root, name)?;
        if target.exists() {
            anyhow::bail!(
                "target {} already exists. Export stopped.",
                target.display()
            );
        }

        if let Some(ref tx) = progress_tx {
            let _ = tx
                .send(crate::progress::ProgressEvent::Export(
                    name.clone(),
                    crate::progress::ExportProgress::FileStarted {
                        name: name.clone(),
                        size: 0,
                    },
                ))
                .await;
        }

        let mut stream = db
            .export_with_opts(iroh_blobs::api::blobs::ExportOptions {
                hash: *hash,
                target,
                mode: iroh_blobs::api::blobs::ExportMode::Copy,
            })
            .stream()
            .await;

        while let Some(item) = stream.next().await {
            match item {
                iroh_blobs::api::blobs::ExportProgressItem::Size(size) => {
                    if let Some(ref tx) = progress_tx {
                        let _ = tx
                            .send(crate::progress::ProgressEvent::Export(
                                name.clone(),
                                crate::progress::ExportProgress::FileProgress {
                                    name: name.clone(),
                                    offset: 0,
                                },
                            ))
                            .await;
                    }
                    let _ = size;
                }
                iroh_blobs::api::blobs::ExportProgressItem::CopyProgress(offset) => {
                    if let Some(ref tx) = progress_tx {
                        let _ = tx
                            .send(crate::progress::ProgressEvent::Export(
                                name.clone(),
                                crate::progress::ExportProgress::FileProgress {
                                    name: name.clone(),
                                    offset,
                                },
                            ))
                            .await;
                    }
                }
                iroh_blobs::api::blobs::ExportProgressItem::Done => {
                    if let Some(ref tx) = progress_tx {
                        let _ = tx
                            .send(crate::progress::ProgressEvent::Export(
                                name.clone(),
                                crate::progress::ExportProgress::FileCompleted {
                                    name: name.clone(),
                                },
                            ))
                            .await;
                    }
                }
                iroh_blobs::api::blobs::ExportProgressItem::Error(cause) => {
                    anyhow::bail!("error exporting {}: {}", name, cause);
                }
            }
        }
    }

    if let Some(ref tx) = progress_tx {
        let _ = tx
            .send(crate::progress::ProgressEvent::Export(
                "".to_string(),
                crate::progress::ExportProgress::Completed,
            ))
            .await;
    }

    Ok(())
}

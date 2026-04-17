//! File export functionality.

use iroh_blobs::{format::collection::Collection, store::fs::FsStore};
use std::path::Path;

use n0_future::StreamExt;

use crate::{get_export_path, progress::ProgressSenderTx};

/// Generate a unique target path by appending a numeric suffix when the file already exists.
/// e.g. `photo.jpg` → `photo (1).jpg` → `photo (2).jpg`
fn unique_target_path(target: &std::path::Path) -> anyhow::Result<std::path::PathBuf> {
    let parent = target
        .parent()
        .ok_or_else(|| anyhow::anyhow!("target has no parent directory"))?;
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| anyhow::anyhow!("target has no valid file stem"))?;
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();

    let mut counter = 1;
    loop {
        let candidate = parent.join(format!("{} ({}){}", stem, counter, ext));
        if !candidate.exists() {
            return Ok(candidate);
        }
        counter += 1;
        if counter > 10000 {
            anyhow::bail!(
                "could not find unique name for {} after 10000 attempts",
                target.display()
            );
        }
    }
}

/// Export a collection to a directory.
///
/// If `export_dir` is None, uses the current directory.
pub async fn export(
    db: &FsStore,
    collection: Collection,
    progress_tx: Option<ProgressSenderTx>,
    export_dir: Option<&Path>,
) -> anyhow::Result<()> {
    // Use provided export_dir or fall back to current directory
    let root = export_dir
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().expect("Failed to get current directory"));

    tracing::info!("📤 Exporting collection to: {:?}", root);

    // Verify directory is writable
    if !root.exists() {
        tracing::error!("❌ Export directory does not exist: {:?}", root);
        anyhow::bail!("Export directory does not exist: {:?}", root);
    }

    // Test write permissions
    let test_file = root.join(".write_test_export");
    std::fs::write(&test_file, b"test").map_err(|e| {
        tracing::error!("❌ Export directory not writable {:?}: {}", root, e);
        anyhow::anyhow!("Export directory not writable {:?}: {}", root, e)
    })?;
    std::fs::remove_file(&test_file).ok();

    tracing::info!("✅ Export directory writable: {:?}", root);

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

        let target = if target.exists() {
            unique_target_path(&target)?
        } else {
            target
        };

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

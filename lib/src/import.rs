//! File import functionality.

use anyhow::Context;
use futures_buffered::BufferedStreamExt;
use iroh_blobs::{format::collection::Collection, store::fs::FsStore, BlobFormat};

use n0_future::StreamExt;

use crate::{progress::ProgressSenderTx, validate_path_component};

/// Import a file or directory into the database.
///
/// The returned tag always refers to a collection. If the input is a file, this
/// is a collection with a single blob, named like the file.
///
/// If the input is a directory, the collection contains all the files in the
/// directory.
pub async fn import(
    path: std::path::PathBuf,
    db: &FsStore,
    progress_tx: Option<ProgressSenderTx>,
) -> anyhow::Result<(iroh_blobs::Hash, u64, Collection)> {
    import_internal(path, db, progress_tx).await
}

async fn import_internal(
    path: std::path::PathBuf,
    db: &FsStore,
    progress_tx: Option<ProgressSenderTx>,
) -> anyhow::Result<(iroh_blobs::Hash, u64, Collection)> {
    let parallelism = num_cpus::get();
    let path = path.canonicalize()?;
    anyhow::ensure!(path.exists(), "path {} does not exist", path.display());
    let root = path.parent().context("get parent")?;

    // walkdir also works for files, so we don't need to special case them
    let files = walkdir::WalkDir::new(path.clone()).into_iter();

    // flatten the directory structure into a list of (name, path) pairs.
    // ignore symlinks.
    let data_sources: Vec<(String, std::path::PathBuf)> = files
        .map(|entry| {
            let entry = entry?;
            if !entry.file_type().is_file() {
                // Skip symlinks. Directories are handled by WalkDir.
                return Ok(None);
            }
            let path = entry.into_path();
            let relative = path.strip_prefix(root)?;
            let name = crate::canonicalized_path_to_string(relative, true)?;
            anyhow::Ok(Some((name, path)))
        })
        .filter_map(Result::transpose)
        .collect::<anyhow::Result<Vec<_>>>()?;

    if let Some(ref tx) = progress_tx {
        let _ = tx
            .send(crate::progress::ProgressEvent::Import(
                "".to_string(),
                crate::progress::ImportProgress::Started {
                    total_files: data_sources.len(),
                },
            ))
            .await;
    }

    // import all the files, using num_cpus workers, return names and temp tags
    let mut names_and_tags = n0_future::stream::iter(data_sources)
        .map(|(name, path)| {
            let db = db.clone();
            let progress_tx = progress_tx.clone();
            async move {
                if let Some(ref tx) = progress_tx {
                    let _ = tx
                        .send(crate::progress::ProgressEvent::Import(
                            name.clone(),
                            crate::progress::ImportProgress::FileStarted {
                                name: name.clone(),
                                size: 0,
                            },
                        ))
                        .await;
                }

                let import = db.add_path_with_opts(iroh_blobs::api::blobs::AddPathOptions {
                    path,
                    mode: iroh_blobs::api::blobs::ImportMode::TryReference,
                    format: BlobFormat::Raw,
                });
                let mut stream = import.stream().await;
                let mut item_size = 0u64;
                let temp_tag = loop {
                    let item = stream
                        .next()
                        .await
                        .context("import stream ended without a tag")?;
                    match item {
                        iroh_blobs::api::blobs::AddProgressItem::Size(size) => {
                            item_size = size;
                            if let Some(ref tx) = progress_tx {
                                let _ = tx
                                    .send(crate::progress::ProgressEvent::Import(
                                        name.clone(),
                                        crate::progress::ImportProgress::FileProgress {
                                            name: name.clone(),
                                            offset: 0,
                                        },
                                    ))
                                    .await;
                            }
                        }
                        iroh_blobs::api::blobs::AddProgressItem::CopyProgress(offset) => {
                            if let Some(ref tx) = progress_tx {
                                let _ = tx
                                    .send(crate::progress::ProgressEvent::Import(
                                        name.clone(),
                                        crate::progress::ImportProgress::FileProgress {
                                            name: name.clone(),
                                            offset,
                                        },
                                    ))
                                    .await;
                            }
                        }
                        iroh_blobs::api::blobs::AddProgressItem::CopyDone => {
                            if let Some(ref tx) = progress_tx {
                                let _ = tx
                                    .send(crate::progress::ProgressEvent::Import(
                                        name.clone(),
                                        crate::progress::ImportProgress::FileProgress {
                                            name: name.clone(),
                                            offset: 0,
                                        },
                                    ))
                                    .await;
                            }
                        }
                        iroh_blobs::api::blobs::AddProgressItem::OutboardProgress(offset) => {
                            if let Some(ref tx) = progress_tx {
                                let _ = tx
                                    .send(crate::progress::ProgressEvent::Import(
                                        name.clone(),
                                        crate::progress::ImportProgress::FileProgress {
                                            name: name.clone(),
                                            offset,
                                        },
                                    ))
                                    .await;
                            }
                        }
                        iroh_blobs::api::blobs::AddProgressItem::Error(cause) => {
                            anyhow::bail!("error importing {}: {}", name, cause);
                        }
                        iroh_blobs::api::blobs::AddProgressItem::Done(tt) => {
                            if let Some(ref tx) = progress_tx {
                                let _ = tx
                                    .send(crate::progress::ProgressEvent::Import(
                                        name.clone(),
                                        crate::progress::ImportProgress::FileCompleted {
                                            name: name.clone(),
                                        },
                                    ))
                                    .await;
                            }
                            break tt;
                        }
                    }
                };
                anyhow::Ok((name, temp_tag, item_size))
            }
        })
        .buffered_unordered(parallelism)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect::<anyhow::Result<Vec<_>>>()?;

    names_and_tags.sort_by(|(a, _, _), (b, _, _)| a.cmp(b));

    // total size of all files
    let size = names_and_tags.iter().map(|(_, _, size)| *size).sum::<u64>();

    // collect the (name, hash) tuples into a collection
    // we must also keep the tags around so the data does not get gced.
    let (collection, tags) = names_and_tags
        .into_iter()
        .map(|(name, tag, _)| ((name, tag.hash()), tag))
        .unzip::<_, _, Collection, Vec<_>>();
    let collection_tag = collection.clone().store(db).await?;
    let hash = collection_tag.hash();

    // now that the collection is stored, we can drop the tags
    // data is protected by the collection
    drop(tags);

    if let Some(ref tx) = progress_tx {
        let _ = tx
            .send(crate::progress::ProgressEvent::Import(
                "".to_string(),
                crate::progress::ImportProgress::Completed { total_size: size },
            ))
            .await;
    }

    Ok((hash, size, collection))
}

/// Get the export path for a given name relative to a root directory.
pub fn get_export_path(root: &std::path::Path, name: &str) -> anyhow::Result<std::path::PathBuf> {
    let parts = name.split('/');
    let mut path = root.to_path_buf();
    for part in parts {
        validate_path_component(part)?;
        path.push(part);
    }
    Ok(path)
}

/// Import data from bytes (for mobile platforms where file paths are not accessible)
///
/// This is used on mobile platforms where we get file content from URIs
/// rather than direct file system paths.
///
/// # Arguments
/// * `name` - The name to give the file in the collection
/// * `data` - The file content as bytes
/// * `db` - The database to store the blobs in
/// * `progress_tx` - Optional progress sender
///
/// # Returns
/// * `(hash, size, collection)` - The hash of the collection, total size, and the collection itself
pub async fn import_from_bytes(
    name: String,
    data: Vec<u8>,
    db: &FsStore,
    progress_tx: Option<ProgressSenderTx>,
) -> anyhow::Result<(iroh_blobs::Hash, u64, Collection)> {
    let size = data.len() as u64;

    if let Some(ref tx) = progress_tx {
        let _ = tx
            .send(crate::progress::ProgressEvent::Import(
                name.clone(),
                crate::progress::ImportProgress::FileStarted {
                    name: name.clone(),
                    size,
                },
            ))
            .await;
    }

    // Import the bytes directly into the store
    let temp_tag = db.add_bytes(data).await?;

    if let Some(ref tx) = progress_tx {
        let _ = tx
            .send(crate::progress::ProgressEvent::Import(
                name.clone(),
                crate::progress::ImportProgress::FileCompleted {
                    name: name.clone(),
                },
            ))
            .await;
    }

    // Create a collection from the (name, hash) tuple
    // Collection implements FromIterator<(Name, Hash)>
    let collection: Collection = std::iter::once((name, temp_tag.hash)).collect();
    let collection_tag = collection.clone().store(db).await?;
    let hash = collection_tag.hash();

    if let Some(ref tx) = progress_tx {
        let _ = tx
            .send(crate::progress::ProgressEvent::Import(
                "".to_string(),
                crate::progress::ImportProgress::Completed { total_size: size },
            ))
            .await;
    }

    Ok((hash, size, collection))
}

use anyhow::{Context, Result};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::config::{expand_path, Config};
use crate::fs::now_ms;
use crate::history::History;
use crate::network::Network;
use crate::state::State;

/// Aggregate status information for display.
#[derive(Debug, Clone, Serialize)]
pub struct StatusInfo {
    pub device_name: String,
    pub namespace_id: Option<String>,
    pub author_id: Option<String>,
    pub online_peers: Vec<PeerDisplay>,
    pub targets: Vec<TargetStatus>,
    pub recent_events: Vec<EventDisplay>,
    pub conflict_files: Vec<ConflictFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PeerDisplay {
    pub node_id: String,
    pub online: bool,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetStatus {
    pub key: String,
    pub src: String,
    pub file_count: usize,
    pub last_sync_ms: Option<u64>,
    pub has_conflicts: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventDisplay {
    pub timestamp_ms: u64,
    pub action: String,
    pub target_key: String,
    pub relative_path: String,
    pub device_name: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConflictFile {
    pub target_key: String,
    pub relative_path: String,
    pub path: PathBuf,
}

/// Collect status information.
pub async fn collect_status(
    config: &Config,
    state: &State,
    history: &History,
    network: Option<&Network>,
) -> Result<StatusInfo> {
    // Merge persisted peers with current sync peers from the network.
    let mut peers: HashMap<String, PeerDisplay> = history
        .store
        .list_peers()
        .context("listing peers")?
        .into_iter()
        .map(|p| {
            (
                p.node_id.clone(),
                PeerDisplay {
                    node_id: p.node_id,
                    online: p.online,
                    first_seen_ms: p.first_seen_ms,
                    last_seen_ms: p.last_seen_ms,
                },
            )
        })
        .collect();

    if let Some(net) = network {
        let doc = net
            .open_doc(state.namespace_id.as_ref().unwrap().parse().unwrap())
            .await?;
        if let Some(sync_peers) = doc.get_sync_peers().await? {
            let now = now_ms();
            for peer_bytes in sync_peers {
                let peer_id = iroh::PublicKey::try_from(&peer_bytes[..])
                    .map(|pk| pk.to_string())
                    .unwrap_or_else(|_| hex::encode(peer_bytes));
                let first_seen_ms = peers.get(&peer_id).map(|p| p.first_seen_ms).unwrap_or(now);
                peers.insert(
                    peer_id.clone(),
                    PeerDisplay {
                        node_id: peer_id,
                        online: true,
                        first_seen_ms,
                        last_seen_ms: now,
                    },
                );
            }
        }
    }

    let mut online_peers: Vec<PeerDisplay> = peers.into_values().collect();
    online_peers.sort_by_key(|b| std::cmp::Reverse(b.last_seen_ms));

    // Per-target status.
    let mut targets = Vec::new();
    for (key, target) in &config.targets {
        let src = expand_path(&target.src)?;
        let (file_count, has_conflicts, last_sync_ms) =
            scan_target_status(&src, key, history).await?;
        targets.push(TargetStatus {
            key: key.clone(),
            src: target.src.clone(),
            file_count,
            last_sync_ms,
            has_conflicts,
        });
    }

    // Recent events.
    let records = history
        .query(None, None, None, 10)
        .context("querying recent events")?;
    let recent_events = records
        .into_iter()
        .map(|r| EventDisplay {
            timestamp_ms: r.timestamp_ms,
            action: r.action.as_str().to_string(),
            target_key: r.target_key,
            relative_path: r.relative_path,
            device_name: r.device_name,
            details: r.details,
        })
        .collect();

    // Conflict files.
    let conflict_files = collect_conflict_files(config).await?;

    Ok(StatusInfo {
        device_name: state.device_name.clone(),
        namespace_id: state.namespace_id.clone(),
        author_id: state.author_id.clone(),
        online_peers,
        targets,
        recent_events,
        conflict_files,
    })
}

async fn scan_target_status(
    src: &Path,
    target_key: &str,
    history: &History,
) -> Result<(usize, bool, Option<u64>)> {
    if !src.exists() {
        return Ok((0, false, None));
    }

    let mut file_count = 0;
    let mut has_conflicts = false;
    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let meta = entry.metadata().await?;
        if meta.is_dir() {
            let (c, hc, _) = Box::pin(scan_target_status(&path, target_key, history)).await?;
            file_count += c;
            has_conflicts |= hc;
        } else if meta.is_file() {
            let is_conflict = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.contains(".peersync_conflict."))
                .unwrap_or(false);
            if is_conflict {
                has_conflicts = true;
            } else {
                file_count += 1;
            }
        }
    }

    // Last sync time from history.
    let last_sync_ms = history
        .store
        .query_history(Some(target_key), None, None, 1)
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .map(|r| r.timestamp_ms);

    Ok((file_count, has_conflicts, last_sync_ms))
}

async fn collect_conflict_files(config: &Config) -> Result<Vec<ConflictFile>> {
    let mut conflicts = Vec::new();
    for (target_key, target) in &config.targets {
        let src = expand_path(&target.src)?;
        if !src.exists() {
            continue;
        }
        collect_conflicts_in_dir(&src, &src, target_key, &mut conflicts).await?;
    }
    Ok(conflicts)
}

async fn collect_conflicts_in_dir(
    root: &Path,
    dir: &Path,
    target_key: &str,
    out: &mut Vec<ConflictFile>,
) -> Result<()> {
    let mut entries = tokio::fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let meta = entry.metadata().await?;
        if meta.is_dir() {
            Box::pin(collect_conflicts_in_dir(root, &path, target_key, out)).await?;
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.contains(".peersync_conflict."))
            .unwrap_or(false)
        {
            let relative = path
                .strip_prefix(root)
                .ok()
                .and_then(|p| p.to_str())
                .map(|s| s.replace('\\', "/"))
                .unwrap_or_default();
            out.push(ConflictFile {
                target_key: target_key.to_string(),
                relative_path: relative,
                path,
            });
        }
    }
    Ok(())
}

/// Print status in human-readable form.
pub fn print_status(info: &StatusInfo) {
    println!("Device: {}", info.device_name);
    println!(
        "Namespace: {}",
        info.namespace_id.as_deref().unwrap_or("(none)")
    );
    println!("Author: {}", info.author_id.as_deref().unwrap_or("(none)"));

    println!("\nPeers:");
    if info.online_peers.is_empty() {
        println!("  (none seen yet)");
    } else {
        for p in &info.online_peers {
            println!(
                "  {} [{}] last seen {} ms ago",
                p.node_id,
                if p.online { "online" } else { "offline" },
                now_ms().saturating_sub(p.last_seen_ms)
            );
        }
    }

    println!("\nTargets:");
    for t in &info.targets {
        println!(
            "  {} -> {} ({} files{}, last sync: {})",
            t.key,
            t.src,
            t.file_count,
            if t.has_conflicts { ", conflicts" } else { "" },
            t.last_sync_ms
                .map(|ms| format!("{} ms ago", now_ms().saturating_sub(ms)))
                .unwrap_or_else(|| "never".to_string())
        );
    }

    println!("\nRecent events:");
    if info.recent_events.is_empty() {
        println!("  (none)");
    } else {
        for e in &info.recent_events {
            println!(
                "  [{}] {} {}/{} {}",
                e.timestamp_ms,
                e.action,
                e.target_key,
                e.relative_path,
                e.details.as_deref().unwrap_or("")
            );
        }
    }

    println!("\nConflict files:");
    if info.conflict_files.is_empty() {
        println!("  (none)");
    } else {
        for c in &info.conflict_files {
            println!(
                "  {}/{} -> {}",
                c.target_key,
                c.relative_path,
                c.path.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{History, SyncAction, SyncRecord};
    use crate::state::State;

    #[tokio::test]
    async fn test_collect_status_basic() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("sync");
        std::fs::create_dir(&src).unwrap();
        std::fs::write(src.join("a.txt"), "hello").unwrap();

        let mut config = Config {
            device_name: "test".to_string(),
            ..Default::default()
        };
        config.targets.clear();
        config.targets.insert(
            "notes".to_string(),
            crate::config::TargetConfig {
                src: src.to_string_lossy().to_string(),
                ignore: vec![],
            },
        );

        let state = State {
            device_name: "test".to_string(),
            namespace_id: None,
            author_id: None,
            secret_key: None,
            ticket: None,
            peer_ticket: None,
        };

        let history = History::open(Some(tmp.path()), None).unwrap();
        history
            .log(SyncRecord {
                timestamp_ms: crate::fs::now_ms(),
                device_name: "test".to_string(),
                node_id: "node".to_string(),
                target_key: "notes".to_string(),
                relative_path: "a.txt".to_string(),
                action: SyncAction::LocalUpload,
                file_hash: Some("b3_xxx".to_string()),
                size: Some(5),
                updated_at_ms: None,
                details: None,
            })
            .unwrap();

        let info = collect_status(&config, &state, &history, None)
            .await
            .unwrap();

        assert_eq!(info.device_name, "test");
        assert_eq!(info.targets.len(), 1);
        assert_eq!(info.targets[0].file_count, 1);
        assert!(!info.targets[0].has_conflicts);
        assert_eq!(info.recent_events.len(), 1);
        assert_eq!(info.recent_events[0].action, "local_upload");
        assert!(info.conflict_files.is_empty());
    }
}

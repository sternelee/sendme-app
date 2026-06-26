use anyhow::{Context, Result};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::config::{expand_path, TargetConfig};
use crate::fs::IgnoreSet;

/// A filesystem change event relevant to sync.
#[derive(Debug, Clone)]
pub struct FsEvent {
    pub target_key: String,
    pub absolute_path: PathBuf,
    pub relative_path: String,
    pub kind: FsEventKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsEventKind {
    Create,
    Modify,
    Remove,
}

/// Watch configured targets for changes.
pub struct TargetWatcher {
    _watcher: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    rx: mpsc::Receiver<Vec<FsEvent>>,
}

impl TargetWatcher {
    /// Start watching all configured targets.
    ///
    /// `ignore_sets` must contain a compiled [`IgnoreSet`] for every target
    /// in `targets`; pass [`IgnoreSet::empty`] for targets without ignore
    /// patterns. Missing keys are treated as "no ignore" — the file is
    /// always considered for sync.
    pub fn start(
        targets: &HashMap<String, TargetConfig>,
        ignore_sets: &HashMap<String, IgnoreSet>,
    ) -> Result<Self> {
        let (tx, rx) = mpsc::channel(256);
        let targets_for_closure = targets.clone();
        let ignore_sets_for_closure = ignore_sets.clone();

        let mut debouncer = new_debouncer(Duration::from_millis(300), move |result| {
            if let Err(e) =
                handle_debounced_events(result, &targets_for_closure, &ignore_sets_for_closure, &tx)
            {
                tracing::warn!(error = %e, "watcher event handling failed");
            }
        })
        .context("creating file watcher")?;

        for (key, target) in targets {
            let src = match expand_path(&target.src) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(target = %key, error = %e, "skipping target with invalid path");
                    continue;
                }
            };
            if src.exists() {
                debouncer
                    .watcher()
                    .watch(&src, RecursiveMode::Recursive)
                    .with_context(|| format!("watching {}", src.display()))?;
            } else {
                tracing::warn!(target = %key, path = %src.display(), "target path does not exist");
            }
        }

        Ok(Self {
            _watcher: debouncer,
            rx,
        })
    }

    /// Receive the next batch of filesystem events.
    pub async fn recv(&mut self) -> Option<Vec<FsEvent>> {
        self.rx.recv().await
    }
}

fn handle_debounced_events(
    result: notify_debouncer_mini::DebounceEventResult,
    targets: &HashMap<String, TargetConfig>,
    ignore_sets: &HashMap<String, IgnoreSet>,
    tx: &mpsc::Sender<Vec<FsEvent>>,
) -> Result<()> {
    let events = result.context("debouncer error")?;
    let mut out = Vec::new();

    for event in events {
        let path = event.path;
        for (target_key, target) in targets.iter() {
            let src = expand_path(&target.src)?;
            if let Some(rel) = path.strip_prefix(&src).ok().and_then(|p| p.to_str()) {
                let rel = rel.replace('\\', "/");
                if ignore_sets
                    .get(target_key)
                    .map_or(false, |s| s.matches(&rel))
                {
                    continue;
                }
                let kind = match event.kind {
                    DebouncedEventKind::Any => {
                        if path.exists() {
                            FsEventKind::Modify
                        } else {
                            FsEventKind::Remove
                        }
                    }
                    DebouncedEventKind::AnyContinuous => FsEventKind::Modify,
                    _ => FsEventKind::Modify,
                };
                out.push(FsEvent {
                    target_key: target_key.clone(),
                    absolute_path: path.clone(),
                    relative_path: rel,
                    kind,
                });
            }
        }
    }

    if !out.is_empty() {
        tx.try_send(out).ok();
    }
    Ok(())
}

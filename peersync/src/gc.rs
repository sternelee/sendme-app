use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

use crate::config::{expand_path, Config};
use crate::fs::file_mtime_ms;
use crate::history::History;

/// Result of a GC run.
#[derive(Debug, Clone, Default)]
pub struct GcReport {
    pub conflict_backups_removed: Vec<PathBuf>,
    pub tombstones_pruned: usize,
    pub history_records_pruned: usize,
}

/// Run garbage collection.
///
/// - `retention_days`: how many days to keep conflict backups and tombstone records.
/// - `dry_run`: if true, do not actually delete anything.
pub fn run_gc(
    config: &Config,
    history: &History,
    retention_days: u64,
    dry_run: bool,
) -> Result<GcReport> {
    let now = crate::fs::now_ms();
    let retention_ms = retention_days.saturating_mul(24 * 60 * 60 * 1000);
    let cutoff = now.saturating_sub(retention_ms);

    let mut report = GcReport::default();

    // 1. Collect old conflict backups across all targets before deleting anything.
    for target in config.targets.values() {
        let src = expand_path(&target.src)?;
        if src.exists() {
            collect_old_conflicts(&src, cutoff, &mut report.conflict_backups_removed)?;
        }
    }
    if !dry_run {
        for path in &report.conflict_backups_removed {
            if let Err(e) = std::fs::remove_file(path) {
                tracing::warn!(path = %path.display(), error = %e, "failed to remove old conflict backup");
            }
        }
    }

    // 2. Prune old tombstone records from local store.
    report.tombstones_pruned = if dry_run {
        history.old_tombstones(cutoff)?.len()
    } else {
        history.prune_tombstones(cutoff)?
    };

    // 3. Prune old history records (keep 90 days by default, separate from tombstone retention).
    let history_retention_ms = 90_u64.saturating_mul(24 * 60 * 60 * 1000);
    let history_cutoff = now.saturating_sub(history_retention_ms);
    report.history_records_pruned = if dry_run {
        history.count_history_older_than(history_cutoff)?
    } else {
        history.prune(history_cutoff)?
    };

    // 4. Persist last GC time.
    if !dry_run {
        if let Err(e) = history.set_last_gc_ms(now) {
            tracing::warn!(error = %e, "failed to persist last gc time");
        }
    }

    Ok(report)
}

fn collect_old_conflicts(dir: &Path, cutoff_ms: u64, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        let meta = entry.metadata()?;
        if meta.is_dir() {
            collect_old_conflicts(&path, cutoff_ms, out)?;
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.contains(".peersync_conflict."))
            .unwrap_or(false)
        {
            if let Ok(mtime) = file_mtime_ms(&path) {
                if mtime < cutoff_ms {
                    out.push(path);
                }
            }
        }
    }
    Ok(())
}

/// Print a GC report.
pub fn print_report(report: &GcReport, dry_run: bool) {
    let prefix = if dry_run { "Would remove" } else { "Removed" };
    println!(
        "{} {} conflict backup(s)",
        prefix,
        report.conflict_backups_removed.len()
    );
    for p in &report.conflict_backups_removed {
        println!("  {}", p.display());
    }
    println!(
        "{} {} tombstone record(s)",
        prefix, report.tombstones_pruned
    );
    println!(
        "{} {} history record(s)",
        prefix, report.history_records_pruned
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{History, SyncAction, SyncRecord};
    use std::time::SystemTime;

    fn touch_conflict(path: &std::path::Path, modified: SystemTime) {
        std::fs::write(path, "backup").unwrap();
        let f = std::fs::File::open(path).unwrap();
        f.set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
    }

    fn test_config(src: &std::path::Path) -> Config {
        let mut config = Config::default();
        config.targets.clear();
        config.targets.insert(
            "notes".to_string(),
            crate::config::TargetConfig {
                src: src.to_string_lossy().to_string(),
                ignore: vec![],
            },
        );
        config
    }

    #[test]
    fn test_gc_dry_run_keeps_files() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("sync");
        std::fs::create_dir(&src).unwrap();
        let conflict = src.join("a.txt.peersync_conflict.test.1");
        touch_conflict(
            &conflict,
            SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(86400),
        );

        let config = test_config(&src);
        let history = History::open(Some(tmp.path()), None).unwrap();

        let report = run_gc(&config, &history, 1, true).unwrap();
        assert_eq!(report.conflict_backups_removed.len(), 1);
        assert!(conflict.exists());
    }

    #[test]
    fn test_gc_removes_old_conflicts() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("sync");
        std::fs::create_dir(&src).unwrap();
        let old_conflict = src.join("a.txt.peersync_conflict.test.1");
        let new_conflict = src.join("b.txt.peersync_conflict.test.2");
        touch_conflict(
            &old_conflict,
            SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(86400),
        );
        touch_conflict(&new_conflict, SystemTime::now());

        let config = test_config(&src);
        let history = History::open(Some(tmp.path()), None).unwrap();

        let report = run_gc(&config, &history, 1, false).unwrap();
        assert_eq!(report.conflict_backups_removed.len(), 1);
        assert!(!old_conflict.exists());
        assert!(new_conflict.exists());
    }

    #[test]
    fn test_gc_prunes_old_history() {
        let tmp = tempfile::tempdir().unwrap();
        let history = History::open(Some(tmp.path()), None).unwrap();
        let very_old = crate::fs::now_ms().saturating_sub(100 * 24 * 60 * 60 * 1000);
        history
            .log(SyncRecord {
                timestamp_ms: very_old,
                device_name: "d".to_string(),
                node_id: "n".to_string(),
                target_key: "t".to_string(),
                relative_path: "p".to_string(),
                action: SyncAction::LocalUpload,
                file_hash: None,
                size: None,
                updated_at_ms: None,
                details: None,
            })
            .unwrap();

        let config = Config::default();

        let report = run_gc(&config, &history, 0, false).unwrap();
        assert!(report.history_records_pruned >= 1);
        assert!(history.query(None, None, None, 100).unwrap().is_empty());
        assert!(history.last_gc_ms().unwrap().is_some());
    }
}

import { Show, For, createSignal, createMemo, onMount, onCleanup } from "solid-js";
import {
  Play,
  Square,
  Trash2,
  Copy,
  RefreshCw,
  AlertCircle,
  RefreshCcw,
  Circle,
  Plus,
  X,
  FolderOpen,
  Link2,
  FolderPlus,
} from "lucide-solid";
import { Toaster, toast } from "solid-sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { useGlobalStore } from "~/lib/store";
import { copyToClipboard } from "~/lib/utils";
import { triggerHaptic } from "~/lib/haptics";
import {
  peersync_start,
  peersync_stop,
  peersync_get_status,
  peersync_get_ticket,
  peersync_get_history,
  peersync_get_config,
  peersync_save_config,
  peersync_add_target,
  peersync_link_device,
  peersync_run_gc,
  peersync_resolve_conflict,
  type PeerSyncConfig,
  type PeerSyncTargetConfig,
  type PeerSyncSyncRecord,
  type PeerSyncStatusInfo,
  type PeerSyncConflictFile,
} from "~/bindings";

const LOG_LIMIT = 50;
const ACTION_LABELS: Record<PeerSyncSyncRecord["action"], string> = {
  local_upload: "↑ uploaded",
  remote_apply: "↓ applied",
  remote_delete: "× deleted",
  conflict_backup: "⚠ conflict",
  tombstone_published: "∎ tombstone",
  sync_completed: "✓ synced",
  neighbor_up: "● online",
  neighbor_down: "○ offline",
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

function relativePath(target: string, path: string): string {
  return target ? `${target}:${path}` : path;
}

// Parse a comma-separated string into a unique, trimmed, non-empty list.
function parseIgnoreList(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

// Open the native folder picker. Returns null on cancel or error.
async function pickDirectory(): Promise<string | null> {
  try {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) return selected;
  } catch (e) {
    toast.error(`Folder picker failed: ${e}`);
  }
  return null;
}

export function PeerSyncTab() {
  const globalStore = useGlobalStore();
  const [linkTicket, setLinkTicket] = createSignal("");
  const [showLinkInput, setShowLinkInput] = createSignal(false);
  const [editingTargetKey, setEditingTargetKey] = createSignal<string | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragCount, setDragCount] = createSignal(0);

  const ps = () => globalStore.peerSync.state();
  const isRunning = () => ps().engineRunning;
  const isBusy = () => ps().busy;
  const status = () => ps().status;
  const log = () => ps().log;
  const config = () => globalStore.peerSync.state().config;

  const recent = createMemo(() => log().slice(-LOG_LIMIT).reverse());
  const conflicts = createMemo<PeerSyncConflictFile[]>(
    () => status()?.conflict_files ?? [],
  );

  async function refreshAll() {
    if (isBusy()) return;
    try {
      const [s, ticket, history, cfg] = await Promise.all([
        peersync_get_status(),
        peersync_get_ticket(),
        peersync_get_history(LOG_LIMIT),
        peersync_get_config(),
      ]);
      globalStore.peerSync.setStatus(s.status);
      globalStore.peerSync.setEngineRunning(s.engineRunning);
      globalStore.peerSync.setTicket(s.ticket ?? ticket);
      globalStore.peerSync.setConfig(cfg);
      globalStore.peerSync.clearLog();
      for (const r of history) globalStore.peerSync.appendLog(r);
    } catch (e) {
      toast.error(`Refresh failed: ${e}`);
    }
  }

  async function refreshStatus() {
    try {
      const s = await peersync_get_status();
      globalStore.peerSync.setStatus(s.status);
      globalStore.peerSync.setEngineRunning(s.engineRunning);
      globalStore.peerSync.setTicket(s.ticket ?? ps().ticket);
    } catch {
      // Status refresh failures are non-fatal — UI keeps the previous snapshot.
    }
  }

  async function handleStart() {
    triggerHaptic("light");
    globalStore.peerSync.setBusy(true);
    globalStore.peerSync.setLastError(null);
    try {
      await peersync_start();
      globalStore.peerSync.setEngineRunning(true);
      const ticket = await peersync_get_ticket();
      globalStore.peerSync.setTicket(ticket);
      toast.success("Engine started");
      await refreshAll();
    } catch (e) {
      globalStore.peerSync.setLastError(String(e));
      toast.error(`Start failed: ${e}`);
    } finally {
      globalStore.peerSync.setBusy(false);
    }
  }

  async function handleStop() {
    triggerHaptic("light");
    globalStore.peerSync.setBusy(true);
    try {
      await peersync_stop();
      globalStore.peerSync.setEngineRunning(false);
      toast.success("Engine stopped");
    } catch (e) {
      globalStore.peerSync.setLastError(String(e));
      toast.error(`Stop failed: ${e}`);
    } finally {
      globalStore.peerSync.setBusy(false);
    }
  }

  async function handleCopyTicket() {
    const ticket = ps().ticket;
    if (!ticket) return;
    triggerHaptic("selection");
    await copyToClipboard(ticket);
    toast.success("Ticket copied");
  }

  async function handleLink() {
    const ticket = linkTicket().trim();
    if (!ticket) return;
    triggerHaptic("light");
    globalStore.peerSync.setBusy(true);
    try {
      const local = await peersync_link_device(ticket);
      globalStore.peerSync.setTicket(local);
      setLinkTicket("");
      setShowLinkInput(false);
      toast.success("Linked to remote namespace");
      await refreshAll();
    } catch (e) {
      globalStore.peerSync.setLastError(String(e));
      toast.error(`Link failed: ${e}`);
    } finally {
      globalStore.peerSync.setBusy(false);
    }
  }

  async function handleRunGc() {
    triggerHaptic("light");
    globalStore.peerSync.setBusy(true);
    try {
      const report = await peersync_run_gc(30, false);
      toast.success(
        `GC: ${report.conflict_backups_removed.length} conflicts, ${report.tombstones_pruned} tombstones, ${report.history_records_pruned} history`,
      );
    } catch (e) {
      toast.error(`GC failed: ${e}`);
    } finally {
      globalStore.peerSync.setBusy(false);
    }
  }

  async function handleSaveConfig(newConfig: PeerSyncConfig) {
    triggerHaptic("selection");
    globalStore.peerSync.setBusy(true);
    try {
      await peersync_save_config(newConfig);
      globalStore.peerSync.setConfig(newConfig);
      toast.success("Config saved. Restart engine to apply changes.");
    } catch (e) {
      toast.error(`Save failed: ${e}`);
    } finally {
      globalStore.peerSync.setBusy(false);
    }
  }

  async function handleResolveConflict(
    c: PeerSyncConflictFile,
    action: "delete_backup" | "restore_from_backup",
  ) {
    triggerHaptic("warning");
    globalStore.peerSync.setBusy(true);
    try {
      await peersync_resolve_conflict(c.target_key, c.relative_path, action);
      toast.success(
        action === "restore_from_backup"
          ? "Backup restored; new content published to peers"
          : "Conflict backup removed",
      );
      await refreshStatus();
      await refreshAll();
    } catch (e) {
      toast.error(`Resolve failed: ${e}`);
    } finally {
      globalStore.peerSync.setBusy(false);
    }
  }

  async function handleDropPaths(paths: string[]) {
    if (paths.length === 0) return;
    triggerHaptic("light");
    globalStore.peerSync.setBusy(true);
    const added: string[] = [];
    const failed: { path: string; error: string }[] = [];
    try {
      // Optimistically use the path's basename as the label; the backend
      // resolves collisions by appending -2, -3, ...
      for (const path of paths) {
        const basename = path.split(/[\\/]/).pop() || path;
        try {
          const cfg = await peersync_add_target(basename, path);
          globalStore.peerSync.setConfig(cfg);
          added.push(basename);
        } catch (e) {
          failed.push({ path, error: String(e) });
        }
      }
      if (added.length > 0) {
        toast.success(
          `Added ${added.length} target${added.length === 1 ? "" : "s"}`,
        );
      }
      for (const f of failed) {
        toast.error(`Skipped ${f.path}: ${f.error}`);
      }
    } finally {
      globalStore.peerSync.setBusy(false);
    }
  }

  // Window-level drag-drop listener. Drops anywhere on the window feed paths
  // into the targets list — non-directory paths are rejected by the backend.
  onMount(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        unlisten = await win.onDragDropEvent(
          (event: { payload: { type: string; paths?: string[] } }) => {
            const { type, paths } = event.payload;
            if (type === "enter" || type === "over") {
              setDragCount(paths?.length ?? 0);
              setIsDragging(true);
            } else if (type === "leave") {
              setIsDragging(false);
              setDragCount(0);
            } else if (type === "drop") {
              setIsDragging(false);
              setDragCount(0);
              void handleDropPaths(paths ?? []);
            }
          },
        );
      } catch {
        // Not running inside Tauri (e.g. browser preview) — silently disable
        // drag-drop. The rest of the UI still works via the manual form.
      }
    })();
    onCleanup(() => unlisten?.());
  });

  return (
    <div class="space-y-4">
      <Toaster position="top-center" />

      {/* Engine control bar */}
      <div class="card border-base-300 bg-base-100 border">
        <div class="card-body p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Circle
                size={10}
                fill={isRunning() ? "#22c55e" : "#9ca3af"}
                color={isRunning() ? "#22c55e" : "#9ca3af"}
              />
              <span class="font-semibold">
                {isRunning() ? "Engine running" : "Engine stopped"}
              </span>
            </div>
            <div class="flex gap-2">
              <Show
                when={!isRunning()}
                fallback={
                  <button
                    class="btn btn-sm btn-ghost"
                    disabled={isBusy()}
                    onClick={handleStop}
                  >
                    <Square size={14} />
                    Stop
                  </button>
                }
              >
                <button
                  class="btn btn-sm btn-primary"
                  disabled={isBusy()}
                  onClick={handleStart}
                >
                  <Play size={14} />
                  Start
                </button>
              </Show>
              <button
                class="btn btn-sm btn-ghost"
                disabled={isBusy()}
                onClick={refreshAll}
                title="Refresh"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <Show when={ps().lastError}>
            <div class="alert alert-error mt-3">
              <AlertCircle size={16} />
              <span class="text-sm">{ps().lastError}</span>
            </div>
          </Show>
        </div>
      </div>

      {/* Ticket card */}
      <div class="card border-base-300 bg-base-100 border">
        <div class="card-body p-4">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold uppercase opacity-70">
              Share ticket
            </span>
            <div class="flex gap-2">
              <button
                class="btn btn-xs btn-ghost"
                onClick={() => setShowLinkInput(!showLinkInput())}
              >
                <Link2 size={12} />
                {showLinkInput() ? "Cancel link" : "Link device"}
              </button>
            </div>
          </div>
          <Show
            when={ps().ticket}
            fallback={
              <p class="text-base-content/60 text-sm">
                Start the engine to generate a ticket.
              </p>
            }
          >
            <div class="bg-base-200 mt-2 flex items-center gap-2 rounded p-2 font-mono text-xs break-all">
              <span class="flex-1">{ps().ticket}</span>
              <button
                class="btn btn-xs btn-ghost"
                onClick={handleCopyTicket}
                title="Copy"
              >
                <Copy size={12} />
              </button>
            </div>
          </Show>
          <Show when={showLinkInput()}>
            <div class="mt-2 flex gap-2">
              <input
                class="input input-sm input-bordered flex-1 font-mono text-xs"
                placeholder="Paste remote ticket here"
                value={linkTicket()}
                onInput={(e) => setLinkTicket(e.currentTarget.value)}
              />
              <button
                class="btn btn-sm btn-primary"
                disabled={isBusy() || !linkTicket().trim()}
                onClick={handleLink}
              >
                Link
              </button>
            </div>
          </Show>
        </div>
      </div>

      {/* Status overview */}
      <Show when={status()}>
        {(s: () => PeerSyncStatusInfo) => (
          <div class="card border-base-300 bg-base-100 border">
            <div class="card-body p-4">
              <span class="text-sm font-semibold uppercase opacity-70">
                Status
              </span>
              <div class="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div class="text-base-content/60 text-xs">Device</div>
                  <div class="font-mono">{s().device_name || "—"}</div>
                </div>
                <div>
                  <div class="text-base-content/60 text-xs">Peers seen</div>
                  <div>{s().online_peers.length}</div>
                </div>
                <div>
                  <div class="text-base-content/60 text-xs">Targets</div>
                  <div>{s().targets.length}</div>
                </div>
                <div>
                  <div class="text-base-content/60 text-xs">Conflicts</div>
                  <div class={conflicts().length > 0 ? "text-warning" : ""}>
                    {conflicts().length}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* Targets editor */}
      <Show when={config()}>
        {(cfg: () => PeerSyncConfig) => (
          <TargetsCard
            config={cfg()}
            editingKey={editingTargetKey()}
            onEdit={setEditingTargetKey}
            onSave={handleSaveConfig}
            isRunning={isRunning()}
            isDragging={isDragging()}
            dragCount={dragCount()}
          />
        )}
      </Show>

      {/* Conflicts */}
      <Show when={conflicts().length > 0}>
        <div class="card border-warning/40 bg-base-100 border">
          <div class="card-body p-4">
            <div class="flex items-center justify-between">
              <span class="text-warning text-sm font-semibold uppercase">
                Conflict backups ({conflicts().length})
              </span>
            </div>
            <p class="text-base-content/60 mt-1 text-xs">
              Files starting with{" "}
              <code class="text-xs">.peersync_conflict.</code> are older
              versions kept when a remote file overwrote a local one. Delete
              the backup to accept the remote copy.
            </p>
            <div class="mt-2 space-y-1">
              <For each={conflicts()}>
                {(c) => (
                  <div class="flex items-center gap-2 text-sm">
                    <span class="flex-1 truncate font-mono text-xs">
                      {relativePath(c.target_key, c.relative_path)}
                    </span>
                    <button
                      class="btn btn-xs btn-ghost"
                      disabled={isBusy()}
                      onClick={() =>
                        handleResolveConflict(c, "restore_from_backup")
                      }
                      title="Replace the main file with the backup content and re-publish"
                    >
                      Restore backup
                    </button>
                    <button
                      class="btn btn-xs btn-warning"
                      disabled={isBusy()}
                      onClick={() => handleResolveConflict(c, "delete_backup")}
                    >
                      <Trash2 size={11} />
                      Discard
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* GC */}
      <div class="card border-base-300 bg-base-100 border">
        <div class="card-body p-4">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold uppercase opacity-70">
              Garbage collection
            </span>
            <button
              class="btn btn-sm btn-ghost"
              disabled={isBusy()}
              onClick={handleRunGc}
            >
              <RefreshCcw size={14} />
              Run GC
            </button>
          </div>
        </div>
      </div>

      {/* Log tail */}
      <div class="card border-base-300 bg-base-100 border">
        <div class="card-body p-4">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold uppercase opacity-70">
              Recent activity
            </span>
            <button
              class="btn btn-xs btn-ghost"
              onClick={() => globalStore.peerSync.clearLog()}
              title="Clear in-memory log"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <Show
            when={recent().length > 0}
            fallback={
              <p class="text-base-content/60 mt-2 text-sm">
                No activity yet.
              </p>
            }
          >
            <div class="mt-2 max-h-80 space-y-1 overflow-y-auto">
              <For each={recent()}>
                {(r) => (
                  <div class="text-base-content/80 flex items-start gap-2 font-mono text-xs">
                    <span class="text-base-content/50 shrink-0">
                      {formatTime(r.timestamp_ms)}
                    </span>
                    <span class="shrink-0">
                      {ACTION_LABELS[r.action] ?? r.action}
                    </span>
                    <span class="flex-1 truncate">
                      {relativePath(r.target_key, r.relative_path)}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ----- Targets editor subcomponent -----

function TargetsCard(props: {
  config: PeerSyncConfig;
  editingKey: string | null;
  onEdit: (key: string | null) => void;
  onSave: (config: PeerSyncConfig) => void;
  isRunning: boolean;
  isDragging: boolean;
  dragCount: number;
}) {
  const targets = createMemo(() =>
    Object.entries(props.config.sync_targets).map(([key, t]) => ({ key, target: t })),
  );
  const [newKey, setNewKey] = createSignal("");
  const [newSrc, setNewSrc] = createSignal("");
  const [newIgnore, setNewIgnore] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const isEmpty = () => targets().length === 0;

  async function pickForNew() {
    const dir = await pickDirectory();
    if (dir) setNewSrc(dir);
  }

  function addTarget() {
    const key = newKey().trim();
    const src = newSrc().trim();
    if (!key || !src) return;
    const ignore = parseIgnoreList(newIgnore());
    const cfg: PeerSyncConfig = {
      device_name: props.config.device_name,
      sync_targets: {
        ...props.config.sync_targets,
        [key]: { src, ignore },
      },
    };
    props.onSave(cfg);
    setNewKey("");
    setNewSrc("");
    setNewIgnore("");
    setAdding(false);
  }

  function removeTarget(key: string) {
    const next = { ...props.config.sync_targets };
    delete next[key];
    props.onSave({
      device_name: props.config.device_name,
      sync_targets: next,
    });
  }

  function updateTarget(key: string, updated: PeerSyncTargetConfig) {
    props.onSave({
      device_name: props.config.device_name,
      sync_targets: {
        ...props.config.sync_targets,
        [key]: updated,
      },
    });
  }

  return (
    <div class="card border-base-300 bg-base-100 relative border">
      <Show when={props.isDragging}>
        <div class="bg-primary/10 border-primary absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg border-2 border-dashed backdrop-blur-sm">
          <FolderPlus size={40} class="text-primary mb-2" />
          <p class="text-primary text-sm font-semibold">
            Drop to add as sync targets
          </p>
          <Show when={props.dragCount > 0}>
            <p class="text-base-content/70 mt-1 text-xs">
              {props.dragCount} item{props.dragCount === 1 ? "" : "s"} ready
            </p>
          </Show>
        </div>
      </Show>
      <div class="card-body p-4">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold uppercase opacity-70">
            Sync targets ({targets().length})
          </span>
          <button
            class="btn btn-xs btn-ghost"
            onClick={() => setAdding(!adding())}
          >
            <Plus size={12} />
            Add
          </button>
        </div>

        <Show when={props.isRunning}>
          <div class="alert alert-warning mt-2 text-xs">
            <AlertCircle size={12} />
            <span>
              Engine is running. Restart it after editing to apply changes.
            </span>
          </div>
        </Show>

        <Show when={adding()}>
          <div class="bg-base-200 mt-2 space-y-2 rounded p-3">
            <input
              class="input input-sm input-bordered w-full"
              placeholder="Label (e.g. nvim)"
              value={newKey()}
              onInput={(e) => setNewKey(e.currentTarget.value)}
            />
            <div class="flex gap-2">
              <input
                class="input input-sm input-bordered flex-1 font-mono text-xs"
                placeholder="Source path (e.g. ~/.config/nvim)"
                value={newSrc()}
                onInput={(e) => setNewSrc(e.currentTarget.value)}
              />
              <button class="btn btn-sm btn-ghost" onClick={pickForNew}>
                <FolderPlus size={12} />
                Pick
              </button>
            </div>
            <textarea
              class="textarea textarea-sm textarea-bordered w-full font-mono text-xs"
              placeholder="Ignore patterns — glob syntax (e.g. *.swp, .git/**, node_modules/**)"
              rows={2}
              value={newIgnore()}
              onInput={(e) => setNewIgnore(e.currentTarget.value)}
            />
            <div class="flex justify-end gap-2">
              <button
                class="btn btn-xs btn-ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button
                class="btn btn-xs btn-primary"
                disabled={!newKey().trim() || !newSrc().trim()}
                onClick={addTarget}
              >
                Add target
              </button>
            </div>
          </div>
        </Show>

        <Show when={isEmpty() && !adding()}>
          <div class="bg-base-200 mt-2 rounded-lg p-6 text-center">
            <FolderOpen size={28} class="text-base-content/40 mx-auto mb-2" />
            <p class="text-sm font-semibold">No sync targets yet</p>
            <p class="text-base-content/60 mt-1 text-xs">
              Add a folder to start syncing it across your devices.
            </p>
            <button
              class="btn btn-sm btn-primary mt-3"
              onClick={() => setAdding(true)}
            >
              <Plus size={14} />
              Add your first target
            </button>
          </div>
        </Show>

        <div class="mt-2 space-y-2">
          <For each={targets()}>
            {({ key, target }) => (
              <Show
                when={props.editingKey === key}
                fallback={
                  <div class="flex items-center gap-2 text-sm">
                    <FolderOpen size={14} class="opacity-60" />
                    <span class="font-mono font-semibold">{key}</span>
                    <span class="text-base-content/60 flex-1 truncate font-mono text-xs">
                      {target.src}
                    </span>
                    <Show when={target.ignore.length > 0}>
                      <span class="badge badge-ghost badge-sm">
                        {target.ignore.length} ignore
                      </span>
                    </Show>
                    <button
                      class="btn btn-xs btn-ghost"
                      onClick={() => props.onEdit(key)}
                    >
                      Edit
                    </button>
                    <button
                      class="btn btn-xs btn-ghost text-error"
                      onClick={() => removeTarget(key)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                }
              >
                <TargetEditRow
                  keyName={key}
                  target={target}
                  onCancel={() => props.onEdit(null)}
                  onSave={(updated) => {
                    updateTarget(key, updated);
                    props.onEdit(null);
                  }}
                />
              </Show>
            )}
          </For>
          <Show when={targets().length === 0}>
            <p class="text-base-content/60 text-sm">
              No targets yet. Add one to start syncing.
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
}

function TargetEditRow(props: {
  keyName: string;
  target: PeerSyncTargetConfig;
  onCancel: () => void;
  onSave: (updated: PeerSyncTargetConfig) => void;
}) {
  const [src, setSrc] = createSignal(props.target.src);
  const [ignore, setIgnore] = createSignal(props.target.ignore.join(", "));

  async function pick() {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string" && selected) {
        setSrc(selected);
      }
    } catch (e) {
      toast.error(`Folder picker failed: ${e}`);
    }
  }

  return (
    <div class="bg-base-200 space-y-2 rounded p-3">
      <div class="font-mono text-sm font-semibold">{props.keyName}</div>
      <div class="flex gap-2">
        <input
          class="input input-sm input-bordered flex-1 font-mono text-xs"
          value={src()}
          onInput={(e) => setSrc(e.currentTarget.value)}
        />
        <button class="btn btn-sm btn-ghost" onClick={pick}>
          <FolderPlus size={12} />
          Pick
        </button>
      </div>
      <textarea
        class="textarea textarea-sm textarea-bordered w-full font-mono text-xs"
        rows={2}
        value={ignore()}
        onInput={(e) => setIgnore(e.currentTarget.value)}
      />
      <div class="flex justify-end gap-2">
        <button class="btn btn-xs btn-ghost" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          class="btn btn-xs btn-primary"
          onClick={() =>
            props.onSave({
              src: src().trim(),
              ignore: parseIgnoreList(ignore()),
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

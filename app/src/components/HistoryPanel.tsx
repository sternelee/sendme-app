import { Component, Show, For, createMemo, createSignal } from "solid-js";
import { History, Trash2, Send, Download } from "lucide-solid";
import {
  formatDate,
  formatFileSize,
  formatDuration,
  getDisplayName,
} from "@sendme/ui";
import { i18n } from "@sendme/shared";
import { open_received_file, delete_transfer } from "~/bindings";
import { toast } from "solid-sonner";
import type { Transfer } from "~/lib/types";
import { getFileIconComponent } from "~/lib/utils";

const t = i18n.t;

interface HistoryPanelProps {
  transfers: Transfer[];
  onReload?: () => void;
  onReshare?: (transfer: Transfer) => void;
}

export const HistoryPanel: Component<HistoryPanelProps> = (props) => {
  const [selectedHistory, setSelectedHistory] = createSignal<Set<string>>(
    new Set<string>(),
  );

  const historyTransfers = createMemo(() =>
    props.transfers
      .filter((t) => t.status === "completed")
      .sort(
        (a, b) =>
          (b.completed_at ?? b.created_at) - (a.completed_at ?? a.created_at),
      ),
  );

  async function handleOpenFile(transfer: Transfer) {
    if (
      transfer.transfer_type === "receive" &&
      transfer.status.includes("complete")
    ) {
      try {
        await open_received_file(transfer.id);
      } catch (e) {}
    }
  }

  async function handleCancel(transfer: Transfer) {
    try {
      if (transfer.status === "cancelled") {
        await delete_transfer(transfer.id);
      } else {
        const { cancel_transfer } = await import("~/bindings");
        await cancel_transfer(transfer.id);
      }
      props.onReload?.();
    } catch (e) {}
  }

  async function handleClearTransfers() {
    try {
      const { clear_transfers } = await import("~/bindings");
      await clear_transfers();
      props.onReload?.();
      setSelectedHistory(new Set<string>());
      toast.success(t("common.clear") + "!");
    } catch (e) {}
  }

  function toggleHistorySelection(id: string) {
    setSelectedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllHistory() {
    const items = historyTransfers();
    setSelectedHistory((prev) => {
      if (prev.size === items.length) return new Set<string>();
      return new Set(items.map((t) => t.id));
    });
  }

  async function handleDeleteSelectedHistory() {
    const ids = [...selectedHistory()];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => delete_transfer(id)));
      props.onReload?.();
      setSelectedHistory(new Set<string>());
      toast.success(t("common.clear") + "!");
    } catch (e) {}
  }

  return (
    <div class="space-y-4">
      <div class="flex items-end justify-between">
        <div>
          <p class="section-label">{t("history.title")}</p>
          <p class="text-base-content/65 mt-2 text-sm leading-6">
            {t("history.receivedFiles")}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Show when={selectedHistory().size > 0}>
            <button
              onClick={handleDeleteSelectedHistory}
              class="btn btn-ghost btn-sm text-error rounded-xl"
            >
              {selectedHistory().size > 1
                ? `${t("common.clear")} (${selectedHistory().size})`
                : t("common.clear")}
            </button>
          </Show>
          <button
            onClick={handleClearTransfers}
            class="btn btn-ghost btn-sm text-error rounded-xl"
            disabled={historyTransfers().length === 0}
          >
            {t("history.clear")}
          </button>
        </div>
      </div>

      <Show when={historyTransfers().length > 0}>
        <div class="flex items-center gap-3">
          <label class="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              class="checkbox checkbox-sm rounded"
              checked={
                selectedHistory().size === historyTransfers().length &&
                historyTransfers().length > 0
              }
              onChange={toggleSelectAllHistory}
            />
            <span class="text-xs opacity-70">
              {selectedHistory().size > 0
                ? `${selectedHistory().size} / ${historyTransfers().length}`
                : `${historyTransfers().length} files`}
            </span>
          </label>
        </div>
      </Show>

      <Show
        when={historyTransfers().length > 0}
        fallback={
          <div class="surface-card flex flex-col items-center justify-center py-16 text-center opacity-70">
            <History size={48} class="mb-3 opacity-30" />
            <p class="text-sm font-medium">{t("history.empty")}</p>
            <p class="text-base-content/60 mt-1 text-xs">
              {t("history.emptyDesc")}
            </p>
          </div>
        }
      >
        <div class="space-y-3">
          <For each={historyTransfers()}>
            {(transfer) => {
              const isSelected = () => selectedHistory().has(transfer.id);
              const FileIcon = getFileIconComponent(transfer.path);
              const isSend = () => transfer.transfer_type === "send";
              return (
                <div class="surface-card p-4">
                  <div class="flex items-center gap-3">
                    <label
                      class="cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm rounded"
                        checked={isSelected()}
                        onChange={() => toggleHistorySelection(transfer.id)}
                      />
                    </label>
                    <div
                      class={`flex h-10 w-10 items-center justify-center rounded-xl ${isSend() ? "bg-primary/12 text-primary" : "bg-secondary/12 text-secondary"}`}
                    >
                      <FileIcon size={18} />
                    </div>

                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span
                          class={`badge badge-xs ${isSend() ? "badge-primary" : "badge-secondary"}`}
                        >
                          {isSend() ? "Sent" : "Received"}
                        </span>
                        <button
                          onClick={() =>
                            isSend()
                              ? props.onReshare?.(transfer)
                              : handleOpenFile(transfer)
                          }
                          class="hover:text-primary truncate text-left text-sm font-semibold"
                        >
                          {transfer.filename ?? getDisplayName(transfer.path)}
                        </button>
                      </div>
                      <div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-70">
                        <span>
                          {formatDate(
                            transfer.completed_at ?? transfer.created_at,
                          )}
                        </span>
                        <Show when={transfer.file_size != null}>
                          <span>· {formatFileSize(transfer.file_size!)}</span>
                        </Show>
                        <Show when={transfer.duration_ms != null}>
                          <span>· {formatDuration(transfer.duration_ms!)}</span>
                        </Show>
                      </div>
                      <p
                        class="text-base-content/40 mt-0.5 truncate text-xs"
                        title={transfer.path}
                      >
                        {transfer.path}
                      </p>
                    </div>

                    <div class="flex shrink-0 items-center gap-1">
                      <Show when={isSend() && transfer.ticket}>
                        <button
                          onClick={() => props.onReshare?.(transfer)}
                          class="btn btn-ghost btn-sm btn-circle"
                          title="Reshare"
                        >
                          <Send size={14} />
                        </button>
                      </Show>
                      <Show when={!isSend()}>
                        <button
                          onClick={() => handleOpenFile(transfer)}
                          class="btn btn-ghost btn-sm btn-circle"
                          title="Open file"
                        >
                          <Download size={14} />
                        </button>
                      </Show>
                      <button
                        onClick={() => handleCancel(transfer)}
                        class="btn btn-ghost btn-sm btn-circle"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

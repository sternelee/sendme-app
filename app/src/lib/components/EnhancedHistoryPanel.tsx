import { Component, Show, For, createSignal, createMemo } from "solid-js";
import {
  History,
  Trash2,
  Send,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  File,
  ChevronRight,
  X,
} from "lucide-solid";
import {
  formatDate,
  formatFileSize,
  formatDuration,
  getDisplayName,
} from "@sendme/ui";
import { i18n } from "@sendme/shared";
import { open_received_file, delete_transfer } from "~/bindings";
import { toast } from "solid-sonner";
import { Motion, Presence } from "solid-motionone";
import type { Transfer } from "~/lib/types";
import { getFileIconComponent, copyToClipboard } from "~/lib/utils";

const t = i18n.t;

// 文件预览模态框
interface FilePreviewModalProps {
  transfer: Transfer | null;
  isOpen: boolean;
  onClose: () => void;
}

const FilePreviewModal: Component<FilePreviewModalProps> = (props) => {
  const isImage = () => {
    const ext = props.transfer?.filename?.split(".").pop()?.toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext || "");
  };

  const isText = () => {
    const ext = props.transfer?.filename?.split(".").pop()?.toLowerCase();
    return [
      "txt",
      "md",
      "json",
      "js",
      "ts",
      "html",
      "css",
      "py",
      "rs",
    ].includes(ext || "");
  };

  return (
    <Presence>
      <Show when={props.isOpen && props.transfer}>
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={props.onClose}
        >
          <Motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            class="bg-base-100 max-h-[80vh] w-full max-w-lg overflow-hidden rounded-3xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div class="border-base-300/50 flex items-center justify-between border-b p-4">
              <div class="flex items-center gap-3">
                <div
                  class={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    props.transfer?.transfer_type === "send"
                      ? "bg-primary/12 text-primary"
                      : "bg-secondary/12 text-secondary"
                  }`}
                >
                  {props.transfer &&
                    getFileIconComponent(props.transfer.path)({ size: 20 })}
                </div>
                <div>
                  <p class="max-w-[200px] truncate text-sm font-medium">
                    {props.transfer?.filename ||
                      getDisplayName(props.transfer?.path || "")}
                  </p>
                  <p class="text-xs opacity-50">
                    {props.transfer?.file_size
                      ? formatFileSize(props.transfer.file_size)
                      : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={props.onClose}
                class="btn btn-ghost btn-circle btn-sm"
              >
                <X size={18} />
              </button>
            </div>

            {/* 预览内容 */}
            <div class="flex min-h-[200px] items-center justify-center p-4">
              <Show when={isImage()}>
                <div class="text-center text-sm opacity-50">
                  <ImageIcon size={48} class="mx-auto mb-2 opacity-30" />
                  <p>{t("preview.imagePreview")}</p>
                </div>
              </Show>
              <Show when={isText()}>
                <div class="text-center text-sm opacity-50">
                  <FileText size={48} class="mx-auto mb-2 opacity-30" />
                  <p>{t("preview.textPreview")}</p>
                </div>
              </Show>
              <Show when={!isImage() && !isText()}>
                <div class="text-center text-sm opacity-50">
                  <File size={48} class="mx-auto mb-2 opacity-30" />
                  <p>{t("preview.noPreview")}</p>
                </div>
              </Show>
            </div>

            {/* 底部操作 */}
            <div class="border-base-300/50 flex gap-2 border-t p-4">
              <button
                onClick={() => {
                  if (props.transfer?.transfer_type === "receive") {
                    open_received_file(props.transfer.id).catch(console.error);
                  }
                }}
                class="btn btn-primary btn-sm flex-1 rounded-xl"
              >
                <Download size={14} />
                {t("common.open")}
              </button>
              <Show
                when={
                  props.transfer?.transfer_type === "send" &&
                  props.transfer?.ticket
                }
              >
                <button
                  onClick={() => {
                    // 重新分享逻辑
                  }}
                  class="btn btn-outline btn-sm flex-1 rounded-xl"
                >
                  <Send size={14} />
                  {t("common.share")}
                </button>
              </Show>
            </div>
          </Motion.div>
        </Motion.div>
      </Show>
    </Presence>
  );
};

// 历史记录项组件
interface HistoryItemProps {
  transfer: Transfer;
  isSelected: boolean;
  onToggleSelect: () => void;
  onOpenFile: () => void;
  onReshare?: () => void;
  onDelete: () => void;
  onPreview: () => void;
  index: number;
}

const HistoryItem: Component<HistoryItemProps> = (props) => {
  const isSend = () => props.transfer.transfer_type === "send";
  const transportSchemeLabel = () =>
    props.transfer.transfer_type.startsWith("nearby-")
      ? t("common.airbridgeLocal")
      : t("common.irohRemote");

  return (
    <Motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: props.index * 0.05 }}
      class="surface-card group relative overflow-hidden"
    >
      {/* 悬停背景效果 */}
      <div class="via-primary/5 absolute inset-0 bg-gradient-to-r from-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div class="relative flex items-center gap-3 p-4">
        {/* 选择框 */}
        <label class="cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            class="checkbox checkbox-sm rounded"
            checked={props.isSelected}
            onChange={() => props.onToggleSelect()}
          />
        </label>

        {/* 文件图标 */}
        <div
          class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
            isSend()
              ? "bg-primary/12 text-primary group-hover:bg-primary/20"
              : "bg-secondary/12 text-secondary group-hover:bg-secondary/20"
          }`}
        >
          {getFileIconComponent(props.transfer.path)({ size: 18 })}
        </div>

        {/* 文件信息 */}
        <div class="min-w-0 flex-1" onClick={props.onPreview}>
          <div class="flex items-center gap-2">
            <span
              class={`badge badge-xs ${isSend() ? "badge-primary" : "badge-secondary"}`}
            >
              {isSend() ? t("history.sent") : t("history.received")}
            </span>
            <span class="badge badge-outline badge-xs">{transportSchemeLabel()}</span>
            <span class="truncate text-sm font-medium cursor-pointer hover:text-primary transition-colors">
              {props.transfer.filename ?? getDisplayName(props.transfer.path)}
            </span>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-70">
            <span>
              {formatDate(
                props.transfer.completed_at ?? props.transfer.created_at,
              )}
            </span>
            <Show when={props.transfer.file_size != null}>
              <span>· {formatFileSize(props.transfer.file_size!)}</span>
            </Show>
            <Show when={props.transfer.duration_ms != null}>
              <span>· {formatDuration(props.transfer.duration_ms!)}</span>
            </Show>
          </div>
          <p
            class="text-base-content/40 mt-0.5 truncate text-xs"
            title={props.transfer.path}
          >
            {props.transfer.path}
          </p>
        </div>

        {/* 操作按钮 */}
        <div class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onPreview();
            }}
            class="btn btn-ghost btn-xs btn-circle"
            title={t("common.preview")}
          >
            <Eye size={14} />
          </button>
          <Show when={isSend() && props.transfer.ticket}>
            <button
              onClick={() => {
                if (props.transfer?.ticket) {
                  copyToClipboard(props.transfer.ticket);
                }
              }}
              class="btn btn-outline btn-sm flex-1 rounded-xl"
            >
              <Send size={14} />
              {t("common.share")}
            </button>
          </Show>
          <Show when={!isSend()}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onOpenFile();
              }}
              class="btn btn-ghost btn-xs btn-circle"
              title="Open file"
            >
              <Download size={14} />
            </button>
          </Show>
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete();
            }}
            class="btn btn-ghost btn-xs btn-circle text-error"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* 移动端始终显示的操作按钮 */}
        <div class="flex shrink-0 items-center gap-1 sm:hidden">
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onPreview();
            }}
            class="btn btn-ghost btn-xs btn-circle"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </Motion.div>
  );
};

interface EnhancedHistoryPanelProps {
  transfers: Transfer[];
  onReload?: () => void;
  onReshare?: (transfer: Transfer) => void;
}

export const EnhancedHistoryPanel: Component<EnhancedHistoryPanelProps> = (
  props,
) => {
  const [selectedHistory, setSelectedHistory] = createSignal<Set<string>>(
    new Set<string>(),
  );
  const [previewTransfer, setPreviewTransfer] = createSignal<Transfer | null>(
    null,
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
      {/* 头部 */}
      <div class="flex items-end justify-between">
        <div>
          <p class="section-label">{t("history.title")}</p>
          <p class="text-base-content/65 mt-2 text-sm leading-6">
            {t("history.receivedFiles")}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Show when={selectedHistory().size > 0}>
            <Motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              onClick={handleDeleteSelectedHistory}
              class="btn btn-ghost btn-sm text-error rounded-xl"
            >
              {selectedHistory().size > 1
                ? `${t("common.clear")} (${selectedHistory().size})`
                : t("common.clear")}
            </Motion.button>
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

      {/* 全选 */}
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

      {/* 列表 */}
      <Show
        when={historyTransfers().length > 0}
        fallback={
          <Motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            class="surface-card flex flex-col items-center justify-center py-16 text-center opacity-70"
          >
            <History size={48} class="mb-3 opacity-30" />
            <p class="text-sm font-medium">{t("history.empty")}</p>
            <p class="text-base-content/60 mt-1 text-xs">
              {t("history.emptyDesc")}
            </p>
          </Motion.div>
        }
      >
        <div class="space-y-3">
          <For each={historyTransfers()}>
            {(transfer, index) => (
              <HistoryItem
                transfer={transfer}
                isSelected={selectedHistory().has(transfer.id)}
                onToggleSelect={() => toggleHistorySelection(transfer.id)}
                onOpenFile={() => handleOpenFile(transfer)}
                onReshare={() => props.onReshare?.(transfer)}
                onDelete={() => handleCancel(transfer)}
                onPreview={() => setPreviewTransfer(transfer)}
                index={index()}
              />
            )}
          </For>
        </div>
      </Show>

      {/* 预览模态框 */}
      <FilePreviewModal
        transfer={previewTransfer()}
        isOpen={!!previewTransfer()}
        onClose={() => setPreviewTransfer(null)}
      />
    </div>
  );
};

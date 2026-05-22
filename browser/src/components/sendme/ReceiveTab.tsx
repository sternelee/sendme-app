import { Show, createMemo, onCleanup } from "solid-js";
import toast from "solid-toast";
import { receiveFile, downloadFile } from "../../lib/commands";
import { i18n } from "@sendme/shared";
import { useGlobalStore } from "../../lib/store";
import {
  TbOutlineDownload,
  TbOutlineCheck,
  TbOutlineAlertCircle,
  TbOutlineClipboard,
  TbOutlineShieldLock,
} from "solid-icons/tb";

const t = i18n.t;

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    pdf: "application/pdf",
    txt: "text/plain",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

function isPreviewable(filename: string): boolean {
  const mime = getMimeType(filename);
  return mime.startsWith("image/") || mime.startsWith("video/");
}

export default function ReceiveTab() {
  const globalStore = useGlobalStore();

  const ticket = () => globalStore.receive.state().ticket;
  const isReceiving = () => globalStore.receive.state().isReceiving;
  const receivedFile = () => globalStore.receive.state().receivedFile;
  const error = () => globalStore.receive.state().error;

  // P2-4: Blob URL memory management
  const previewUrl = createMemo(() => {
    const file = receivedFile();
    if (!file || !isPreviewable(file.filename)) return null;
    const mime = getMimeType(file.filename);
    const blob = new Blob([file.data as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    onCleanup(() => URL.revokeObjectURL(url));
    return url;
  });

  async function handleReceive() {
    const ticketValue = ticket().trim();
    if (!ticketValue) {
      toast.error(t("receive.invalidTicket"));
      return;
    }

    globalStore.receive.setIsReceiving(true);
    globalStore.receive.setError("");
    globalStore.receive.setReceivedFile(null);

    try {
      const result = await receiveFile(ticketValue);
      globalStore.receive.setReceivedFile(result);
      toast.success(t("receive.downloadComplete"));
    } catch (err) {
      const errorMsg = (err as Error).message || t("receive.invalidTicket");
      globalStore.receive.setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      globalStore.receive.setIsReceiving(false);
    }
  }

  function downloadReceivedFile() {
    const file = receivedFile();
    if (!file) return;
    downloadFile(file.data, file.filename);
    toast.success(t("receive.saveFile") + ": " + file.filename);
  }

  async function pasteTicket() {
    try {
      const text = await navigator.clipboard.readText();
      globalStore.receive.setTicket(text);
      toast.success(t("receive.pasteTicket") + "!");
    } catch {
      toast.error(t("receive.clipboardError") || "Failed to read clipboard.");
    }
  }

  function formatFileSize(data: Uint8Array): string {
    if (!data || typeof data.length !== "number") return "Unknown size";
    const size = data.length;
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="text-center">
        <h2 class="text-2xl font-bold">{t("receive.title")}</h2>
        <p class="text-base-content/60 text-sm mt-1">{t("receive.subtitle")}</p>
      </div>

      {/* Ticket Input */}
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-3">
          <label class="text-sm font-medium">{t("receive.pasteTicket")}</label>
          <button
            onClick={pasteTicket}
            class="btn btn-ghost btn-xs"
            disabled={isReceiving()}
            title={t("receive.pasteFromClipboard") || "Paste from clipboard"}
          >
            <TbOutlineClipboard size={14} />
            {t("common.paste") || "Paste"}
          </button>
        </div>
        <label class="input input-bordered flex w-full items-center gap-2">
          <TbOutlineShieldLock size={18} class="opacity-50" />
          <input
            type="text"
            value={ticket()}
            onInput={(e) => globalStore.receive.setTicket(e.currentTarget.value)}
            placeholder={t("receive.ticketPlaceholder") || "Paste ticket here..."}
            class="grow font-mono text-sm"
            disabled={isReceiving()}
          />
        </label>
      </div>

      <button
        onClick={() => void handleReceive()}
        disabled={!ticket().trim() || isReceiving()}
        class="btn btn-primary btn-block"
      >
        <TbOutlineDownload size={18} /> {t("receive.receiveFile")}
      </button>

      {/* Error Alert */}
      <Show when={error()}>
        <div class="alert alert-error">
          <TbOutlineAlertCircle size={18} />
          <span>{error()}</span>
        </div>
      </Show>

      {/* Success - File Ready */}
      <Show when={receivedFile()}>
        <div class="alert alert-success">
          <TbOutlineCheck size={18} />
          <div class="flex-1">
            <p class="font-bold">{t("receive.downloadComplete")}</p>
            <p class="text-sm font-mono truncate">{receivedFile()!.filename}</p>
            <p class="text-xs opacity-60">
              {formatFileSize(receivedFile()!.data)} •{" "}
              {t("receive.readyToDownload") || "Ready to download"}
            </p>
          </div>
        </div>

        <Show when={previewUrl()}>
          <div class="w-full h-48 rounded-2xl overflow-hidden bg-base-300">
            <img
              src={previewUrl()!}
              alt={receivedFile()!.filename}
              class="w-full h-full object-contain"
            />
          </div>
        </Show>

        <button onClick={downloadReceivedFile} class="btn btn-success btn-block">
          <TbOutlineDownload size={18} /> {t("receive.saveFile")}
        </button>
      </Show>
    </div>
  );
}

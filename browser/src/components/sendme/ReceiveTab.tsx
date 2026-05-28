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
  TbOutlineFile,
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

function formatFileSize(data: Uint8Array): string {
  if (!data || typeof data.length !== "number") return "Unknown size";
  const size = data.length;
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

export default function ReceiveTab() {
  const globalStore = useGlobalStore();

  const ticket = () => globalStore.receive.state().ticket;
  const isReceiving = () => globalStore.receive.state().isReceiving;
  const receivedFile = () => globalStore.receive.state().receivedFile;
  const error = () => globalStore.receive.state().error;

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
      globalStore.history.addEntry({
        filename: result.filename,
        ticket: ticketValue,
        fileSize: result.data.length,
        isFolder: false,
        type: "received",
      });
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

  return (
    <div class="space-y-4">
      {/* Header */}
      <div>
        <p class="section-label">{t("receive.title")}</p>
        <p class="text-base-content/65 mt-1 text-sm">{t("receive.subtitle")}</p>
      </div>

      {/* Input Card */}
      <div class="surface-card p-5 space-y-4">
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-3">
            <label class="text-sm font-medium">{t("receive.pasteTicket")}</label>
            <button
              onClick={pasteTicket}
              class="btn btn-ghost btn-xs rounded-lg"
              disabled={isReceiving()}
            >
              <TbOutlineClipboard size={14} />
              {t("common.paste") || "Paste"}
            </button>
          </div>
          <label class="input input-bordered flex w-full items-center gap-2 rounded-xl">
            <TbOutlineShieldLock size={18} class="opacity-50" />
            <input
              type="text"
              value={ticket()}
              onInput={(e) => globalStore.receive.setTicket(e.currentTarget.value)}
              placeholder={t("common.pasteTicket")}
              class="grow font-mono text-sm bg-transparent"
              disabled={isReceiving()}
            />
          </label>
        </div>

        <button
          onClick={() => void handleReceive()}
          disabled={!ticket().trim() || isReceiving()}
          class={`btn btn-primary w-full rounded-xl ${isReceiving() ? "loading" : ""}`}
        >
          <Show when={!isReceiving()}
          >
            <TbOutlineDownload size={18} />
          </Show>
          {t("receive.receiveFile")}
        </button>
      </div>

      {/* Error Alert */}
      <Show when={error()}>
        <div class="alert alert-error rounded-xl">
          <TbOutlineAlertCircle size={18} />
          <span>{error()}</span>
        </div>
      </Show>

      {/* Success - File Ready */}
      <Show when={receivedFile()}>
        <div class="surface-card p-5 space-y-4">
          {/* File Info */}
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-secondary/12 text-secondary flex items-center justify-center shrink-0">
              <TbOutlineFile size={24} />
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-sm truncate">{receivedFile()!.filename}</p>
              <p class="text-xs text-base-content/50 mt-0.5">
                {formatFileSize(receivedFile()!.data)}
              </p>
            </div>
            <div class="badge badge-success gap-1 rounded-full shrink-0">
              <TbOutlineCheck size={12} />
              {t("receive.downloadComplete")}
            </div>
          </div>

          {/* Preview */}
          <Show when={previewUrl()}>
            <div class="w-full h-56 rounded-2xl overflow-hidden bg-base-300/50">
              <img
                src={previewUrl()!}
                alt={receivedFile()!.filename}
                class="w-full h-full object-contain"
              />
            </div>
          </Show>

          {/* Download Button */}
          <button
            onClick={downloadReceivedFile}
            class="btn btn-success w-full rounded-xl"
          >
            <TbOutlineDownload size={18} />
            {t("receive.saveFile")}
          </button>
        </div>
      </Show>
    </div>
  );
}

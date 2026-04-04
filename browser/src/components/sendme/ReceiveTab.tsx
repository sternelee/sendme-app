import { createSignal, Show, For } from "solid-js";
import toast from "solid-toast";
import { receiveFile, downloadFile } from "../../lib/commands";
import {
  TbOutlineDownload,
  TbOutlineCheck,
  TbOutlineAlertCircle,
  TbOutlineClipboard,
  TbOutlineShieldLock,
  TbOutlineSparkles,
  TbOutlineDeviceMobile,
  TbOutlineFile,
  TbOutlinePhoto,
  TbOutlineVideo,
} from "solid-icons/tb";
import { useTicketPolling } from "~/lib/composables/useTicketPolling";

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

function createPreviewUrl(data: Uint8Array, filename: string): string {
  const mime = getMimeType(filename);
  const blob = new Blob([data], { type: mime });
  return URL.createObjectURL(blob);
}

export default function ReceiveTab(props: { isActive?: boolean }) {
  const [ticket, setTicket] = createSignal<string>("");
  const [isReceiving, setIsReceiving] = createSignal(false);
  const [receivedFile, setReceivedFile] = createSignal<{
    filename: string;
    data: Uint8Array;
  } | null>(null);
  const [error, setError] = createSignal<string>("");

  const { tickets } = useTicketPolling(() => props.isActive || false);

  async function handleReceive() {
    const ticketValue = ticket().trim();
    if (!ticketValue) {
      toast.error("Please enter a ticket");
      return;
    }

    setIsReceiving(true);
    setError("");
    setReceivedFile(null);

    try {
      const result = await receiveFile(ticketValue);
      setReceivedFile(result);
      toast.success("File received successfully!");
    } catch (err) {
      const errorMsg = (err as Error).message || "Failed to receive file";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsReceiving(false);
    }
  }

  function downloadReceivedFile() {
    const file = receivedFile();
    if (!file) return;
    downloadFile(file.data, file.filename);
    toast.success(`Downloaded ${file.filename}`);
  }

  async function pasteTicket() {
    try {
      const text = await navigator.clipboard.readText();
      setTicket(text);
      toast.success("Ticket pasted!");
    } catch (err) {
      toast.error("Failed to read clipboard.");
    }
  }

  function useIncomingTicket(ticketStr: string, filename?: string | null) {
    setTicket(ticketStr);
    toast.success(`Ticket from ${filename || "another device"} loaded!`);
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
        <h2 class="text-2xl font-bold">Receive a File</h2>
        <p class="text-base-content/60 text-sm mt-1">
          Enter a secure ticket to establish a P2P connection.
        </p>
      </div>

      {/* Incoming Tickets */}
      <Show when={tickets().length > 0}>
        <div class="alert alert-warning">
          <TbOutlineSparkles size={18} />
          <div class="flex-1">
            <span class="font-semibold">
              {tickets().length} Incoming Ticket
              {tickets().length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div class="space-y-2 max-h-40 overflow-y-auto">
          <For each={tickets()}>
            {(incomingTicket) => (
              <div
                class="flex items-center gap-3 p-3 rounded-xl bg-base-300/50 hover:bg-base-300 cursor-pointer transition-colors"
                onClick={() =>
                  useIncomingTicket(
                    incomingTicket.ticket,
                    incomingTicket.filename,
                  )
                }
              >
                <div class="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center">
                  <TbOutlineDeviceMobile size={16} />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium truncate">
                    {incomingTicket.filename || "Unnamed file"}
                  </p>
                  <p class="text-xs text-base-content/50">
                    {incomingTicket.fileSize
                      ? `${(incomingTicket.fileSize / 1024 / 1024).toFixed(2)} MB`
                      : "Unknown size"}
                  </p>
                </div>
                <TbOutlineCheck
                  size={16}
                  class="text-primary opacity-0 group-hover:opacity-100"
                />
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Ticket Input */}
      <div class="form-control">
        <label class="input input-bordered flex items-center gap-2 w-full">
          <TbOutlineShieldLock size={18} class="opacity-50" />
          <input
            type="text"
            value={ticket()}
            onInput={(e) => setTicket(e.currentTarget.value)}
            placeholder="Enter or paste ticket code..."
            class="grow font-mono text-sm"
            disabled={isReceiving()}
          />
          <button
            onClick={pasteTicket}
            class="btn btn-ghost btn-sm"
            disabled={isReceiving()}
            title="Paste from clipboard"
          >
            <TbOutlineClipboard size={16} />
          </button>
        </label>
      </div>

      <button
        onClick={handleReceive}
        disabled={!ticket().trim() || isReceiving()}
        class={`btn btn-primary btn-block ${isReceiving() ? "loading" : ""}`}
      >
        <Show when={!isReceiving()}>
          <TbOutlineDownload size={18} /> Retrieve File
        </Show>
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
            <p class="font-bold">File Available</p>
            <p class="text-sm font-mono truncate">{receivedFile()!.filename}</p>
            <p class="text-xs opacity-60">
              {formatFileSize(receivedFile()!.data)} • Ready to download
            </p>
          </div>
        </div>

        <Show when={isPreviewable(receivedFile()!.filename)}>
          <div class="w-full h-48 rounded-2xl overflow-hidden bg-base-300">
            <img
              src={createPreviewUrl(
                receivedFile()!.data,
                receivedFile()!.filename,
              )}
              alt={receivedFile()!.filename}
              class="w-full h-full object-contain"
            />
          </div>
        </Show>

        <button
          onClick={downloadReceivedFile}
          class="btn btn-success btn-block"
        >
          <TbOutlineDownload size={18} /> Save to Device
        </button>
      </Show>
    </div>
  );
}

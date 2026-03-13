import { createSignal, Show, For, createMemo } from "solid-js";
import toast from "solid-toast";
import { receiveFile, downloadFile } from "../../lib/commands";
import { Motion, Presence } from "solid-motionone";
import {
  TbOutlineDownload,
  TbOutlineCheck,
  TbOutlineAlertCircle,
  TbOutlineClipboard,
  TbOutlineFileDownload,
  TbOutlineShieldLock,
  TbOutlineSparkles,
  TbOutlineDeviceMobile,
  TbOutlineFile,
  TbOutlineFileTypePdf,
  TbOutlinePhoto,
  TbOutlineVideo,
  TbOutlineFileMusic,
} from "solid-icons/tb";
import { useTicketPolling } from "~/lib/composables/useTicketPolling";

// Infer mime type from filename extension
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'ico': 'image/x-icon',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'mkv': 'video/x-matroska',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    'txt': 'text/plain',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'xml': 'application/xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Check if file is previewable (image/video)
function isPreviewable(filename: string): boolean {
  const mime = getMimeType(filename);
  return mime.startsWith('image/') || mime.startsWith('video/');
}

// Create preview URL from received data
function createPreviewUrl(data: Uint8Array, filename: string): string {
  const mime = getMimeType(filename);
  const blob = new Blob([data], { type: mime });
  return URL.createObjectURL(blob);
}

// Get file icon based on filename
function getFileIcon(filename: string) {
  const mime = getMimeType(filename);
  if (mime.startsWith('image/')) return TbOutlinePhoto;
  if (mime.startsWith('video/')) return TbOutlineVideo;
  if (mime.startsWith('audio/')) return TbOutlineFileMusic;
  if (mime === 'application/pdf') return TbOutlineFileTypePdf;
  return TbOutlineFile;
}

interface ReceiveTabProps {
  isActive?: boolean;
}

export default function ReceiveTab(props: ReceiveTabProps) {
  const [ticket, setTicket] = createSignal<string>("");
  const [isReceiving, setIsReceiving] = createSignal(false);
  const [receivedFile, setReceivedFile] = createSignal<{
    filename: string;
    data: Uint8Array;
  } | null>(null);
  const [error, setError] = createSignal<string>("");

  // Only poll when this tab is active
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

  /**
   * Use ticket from incoming tickets list
   */
  function useIncomingTicket(ticketStr: string, filename?: string | null) {
    setTicket(ticketStr);
    toast.success(`Ticket from ${filename || "another device"} loaded!`);
  }

  function formatFileSize(data: Uint8Array): string {
    if (!data || typeof data.length !== "number") {
      return "Unknown size";
    }
    const size = data.length;
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  return (
    <div class="space-y-8">
      {/* Header Info */}
      <div class="text-center space-y-2">
        <h2 class="text-2xl font-bold bg-clip-text text-transparent bg-linear-to-r from-white to-white/70">
          Receive a File
        </h2>
        <p class="text-white/40 text-sm">
          Enter a secure ticket to establish a P2P connection.
        </p>
      </div>

      {/* Incoming Tickets Section */}
      <Presence>
        <Show when={tickets().length > 0}>
          <Motion.div
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            class="glass rounded-2xl p-4 border-purple-500/20 bg-purple-500/5 space-y-3"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 text-purple-400">
                <TbOutlineSparkles size={18} />
                <span class="text-sm font-semibold">
                  {tickets().length} Incoming Ticket
                  {tickets().length > 1 ? "s" : ""}
                </span>
              </div>
            </div>
            <div class="space-y-2 max-h-40 overflow-y-auto">
              <For each={tickets()}>
                {(incomingTicket) => (
                  <Motion.div
                    animate={{ opacity: 1 }}
                    class="flex items-center gap-3 p-3 rounded-xl bg-black/40 border border-white/10 hover:border-purple-500/30 transition-all group cursor-pointer"
                    onClick={() =>
                      useIncomingTicket(
                        incomingTicket.ticket,
                        incomingTicket.filename,
                      )
                    }
                  >
                    <div class="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center flex-shrink-0">
                      <TbOutlineDeviceMobile size={16} />
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm text-white font-medium truncate">
                        {incomingTicket.filename || "Unnamed file"}
                      </p>
                      <p class="text-xs text-white/40">
                        {incomingTicket.fileSize
                          ? `${(incomingTicket.fileSize / 1024 / 1024).toFixed(2)} MB`
                          : "Unknown size"}
                      </p>
                    </div>
                    <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <TbOutlineCheck size={16} class="text-purple-400" />
                    </div>
                  </Motion.div>
                )}
              </For>
            </div>
          </Motion.div>
        </Show>
      </Presence>

      {/* Ticket input */}
      <div class="space-y-5">
        <div class="relative group">
          <div class="absolute inset-y-0 left-4 flex items-center pointer-events-none text-white/20 group-focus-within:text-purple-400 transition-colors">
            <TbOutlineShieldLock size={20} />
          </div>
          <input
            type="text"
            value={ticket()}
            onInput={(e) => setTicket(e.currentTarget.value)}
            placeholder="Enter or paste ticket code..."
            class="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-14 py-4 text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 transition-all text-sm font-mono"
            disabled={isReceiving()}
          />
          <button
            onClick={pasteTicket}
            class="absolute inset-y-2 right-2 px-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all text-white/40 hover:text-white"
            disabled={isReceiving()}
            title="Paste from clipboard"
          >
            <TbOutlineClipboard size={18} />
          </button>
        </div>

        <Motion.button
          hover={{ scale: 1.02, y: -1 }}
          press={{ scale: 0.98, y: 0 }}
          onClick={handleReceive}
          disabled={!ticket().trim() || isReceiving()}
          class="w-full py-4 px-6 bg-linear-to-r from-purple-500 to-indigo-600 disabled:grayscale text-white rounded-2xl font-bold transition-all shadow-xl shadow-purple-500/20 disabled:cursor-not-allowed flex items-center justify-center gap-3 relative overflow-hidden"
        >
          <Show when={isReceiving()}>
            <div class="absolute inset-0 shimmer opacity-20" />
            <div class="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin" />
            <span>Connecting...</span>
          </Show>
          <Show when={!isReceiving()}>
            <TbOutlineDownload size={20} />
            <span>Retrieve File</span>
          </Show>
        </Motion.button>
      </div>

      {/* States Display */}
      <Presence exitBeforeEnter>
        {/* Error alert */}
        <Show when={error()}>
          <Motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            class="glass rounded-2xl p-4 border-red-500/20 bg-red-500/5"
          >
            <div class="flex items-start gap-3 text-red-400">
              <div class="mt-0.5">
                <TbOutlineAlertCircle size={18} />
              </div>
              <div class="flex-1">
                <p class="text-xs font-semibold uppercase tracking-wider opacity-50 mb-1">
                  Authorization Error
                </p>
                <p class="text-sm text-white/80">{error()}</p>
              </div>
            </div>
          </Motion.div>
        </Show>

        {/* Success alert with file */}
        <Show when={receivedFile()}>
          <Motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            class="glass rounded-3xl p-6 border-green-500/20 bg-green-500/5 space-y-6"
          >
            <div class="flex items-center gap-3 text-green-400">
              <div class="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                <TbOutlineCheck size={18} />
              </div>
              <span class="font-bold text-white">File Available</span>
            </div>

            {/* File preview with thumbnail */}
            <div class="glass-inset rounded-2xl p-5 flex items-center gap-4">
              {/* Thumbnail preview */}
              <Show when={isPreviewable(receivedFile()!.filename)}>
                <div class="w-16 h-16 rounded-xl overflow-hidden bg-black/20 flex-shrink-0">
                  <img
                    src={createPreviewUrl(receivedFile()!.data, receivedFile()!.filename)}
                    alt={receivedFile()!.filename}
                    class="w-full h-full object-cover"
                  />
                </div>
              </Show>

              {/* Icon for non-previewable files */}
              <Show when={!isPreviewable(receivedFile()!.filename)}>
                <div class="w-16 h-16 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0 text-green-400">
                  <Show
                    when={getMimeType(receivedFile()!.filename).startsWith('image/')}
                    fallback={
                      <Show
                        when={getMimeType(receivedFile()!.filename).startsWith('video/')}
                        fallback={
                          <Show
                            when={getMimeType(receivedFile()!.filename) === 'application/pdf'}
                            fallback={<TbOutlineFile size={28} />}
                          >
                            <TbOutlineFileTypePdf size={28} />
                          </Show>
                        }
                      >
                        <TbOutlineVideo size={28} />
                      </Show>
                    }
                  >
                    <TbOutlinePhoto size={28} />
                  </Show>
                </div>
              </Show>

              {/* File info */}
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-white truncate">
                  {receivedFile()!.filename}
                </div>
                <div class="text-xs text-white/40 mt-1">
                  {formatFileSize(receivedFile()!.data)} • Ready to download
                </div>
              </div>
            </div>

            <Motion.button
              hover={{ scale: 1.02 }}
              press={{ scale: 0.98 }}
              onClick={downloadReceivedFile}
              class="w-full py-4 px-6 bg-green-500 hover:bg-green-600 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg shadow-green-500/20"
            >
              <TbOutlineDownload size={20} />
              Save to Device
            </Motion.button>
          </Motion.div>
        </Show>
      </Presence>
    </div>
  );
}

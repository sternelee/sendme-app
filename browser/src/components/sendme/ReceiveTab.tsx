import { createSignal } from "solid-js";
import toast from "solid-toast";
import { receiveFile, downloadFile } from "../../lib/commands";
import {
  TbOutlineDownload,
  TbOutlineCheck,
  TbOutlineAlertCircle,
} from "solid-icons/tb";

interface ReceiveTabProps {}

export default function ReceiveTab(_props: ReceiveTabProps) {
  const [ticket, setTicket] = createSignal<string>("");
  const [isReceiving, setIsReceiving] = createSignal(false);
  const [receivedFile, setReceivedFile] = createSignal<{
    filename: string;
    data: Uint8Array;
  } | null>(null);
  const [error, setError] = createSignal<string>("");

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
      toast.success("Ticket pasted from clipboard!");
    } catch (err) {
      toast.error("Failed to read clipboard. Please paste manually.");
    }
  }

  function formatFileSize(data: Uint8Array): string {
    const size = data.length;
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  return (
    <div class="space-y-6">
      {/* Title */}
      <div class="text-center">
        <h2 class="text-2xl font-bold text-white mb-2">Receive Files</h2>
        <p class="text-white/60">Enter a ticket to download files</p>
      </div>

      {/* Ticket input */}
      <div class="space-y-4">
        <div>
          <label class="text-sm text-white/80 mb-2 block">Ticket</label>
          <div class="flex gap-2">
            <input
              type="text"
              value={ticket()}
              onInput={(e) => setTicket(e.currentTarget.value)}
              placeholder="Paste ticket here..."
              class="flex-1 bg-black/30 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder:text-white/40 focus:outline-none focus:border-purple-400 transition-colors"
              disabled={isReceiving()}
            />
            <button
              onClick={pasteTicket}
              class="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isReceiving()}
              aria-label="Paste from clipboard"
            >
              📋
            </button>
          </div>
        </div>

        <button
          onClick={handleReceive}
          disabled={!ticket().trim() || isReceiving()}
          class="w-full py-3 px-6 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-purple-500/50 disabled:to-pink-500/50 text-white rounded-xl font-medium transition-all shadow-lg shadow-purple-500/25 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isReceiving() ? (
            <>
              <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Connecting...
            </>
          ) : (
            <>
              <TbOutlineDownload size={20} />
              Download File
            </>
          )}
        </button>
      </div>

      {/* Error alert */}
      {error() && (
        <div class="bg-red-500/10 border border-red-500/20 rounded-xl p-5">
          <div class="flex items-start gap-3">
            <TbOutlineAlertCircle size={20} class="text-red-400 mt-0.5" />
            <div class="flex-1">
              <h3 class="font-medium text-red-400 mb-1">Error</h3>
              <p class="text-sm text-white/70">{error()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Success alert with file */}
      {receivedFile() && (
        <div class="bg-green-500/10 border border-green-500/20 rounded-xl p-5 space-y-4">
          <div class="flex items-center gap-2 text-green-400">
            <TbOutlineCheck size={20} />
            <span class="font-medium">File Received</span>
          </div>

          <div class="bg-black/30 rounded-lg p-4">
            <div class="font-medium text-white truncate">
              {receivedFile()!.filename}
            </div>
            <div class="text-sm text-white/60 mt-1">
              {formatFileSize(receivedFile()!.data)}
            </div>
          </div>

          <button
            onClick={downloadReceivedFile}
            class="w-full py-3 px-6 bg-green-500 hover:bg-green-600 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            <TbOutlineDownload size={20} />
            Save to Device
          </button>
        </div>
      )}
    </div>
  );
}

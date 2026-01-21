import { createSignal, createMemo } from "solid-js";
import toast from "solid-toast";
import { sendFile } from "../../lib/commands";
import {
  TbOutlineUpload,
  TbOutlineCheck,
  TbOutlineCopy,
} from "solid-icons/tb";

interface SendTabProps {}

export default function SendTab(_props: SendTabProps) {
  const [file, setFile] = createSignal<File | null>(null);
  const [ticket, setTicket] = createSignal<string>("");
  const [isSending, setIsSending] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;

  const dropZoneClass = createMemo(() =>
    isDragging()
      ? "border-purple-400 bg-purple-500/10"
      : "border-white/20 bg-white/5 hover:border-white/30 hover:bg-white/10"
  );

  async function handleSend() {
    const currentFile = file();
    if (!currentFile) return;

    setIsSending(true);
    try {
      const result = await sendFile(currentFile);
      setTicket(result);
      toast.success("Ticket created successfully!");
    } catch (error) {
      console.error("Send failed:", error);
      toast.error("Failed to send file: " + (error as Error).message);
    } finally {
      setIsSending(false);
    }
  }

  function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      setFile(target.files[0]);
      setTicket("");
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      setFile(event.dataTransfer.files[0]);
      setTicket("");
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function copyTicket() {
    navigator.clipboard.writeText(ticket());
    toast.success("Ticket copied to clipboard!");
  }

  function selectFile() {
    fileInputRef?.click();
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  return (
    <div class="space-y-6">
      {/* Title */}
      <div class="text-center">
        <h2 class="text-2xl font-bold text-white mb-2">Send Files</h2>
        <p class="text-white/60">Share files securely over P2P</p>
      </div>

      {/* Drop zone */}
      <div
        class={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${dropZoneClass()}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={selectFile}
      >
        <input
          ref={fileInputRef}
          type="file"
          class="hidden"
          onChange={handleFileSelect}
        />

        {!file() ? (
          <div class="flex flex-col items-center gap-4">
            <TbOutlineUpload size={48} class="text-white/40" />
            <span class="text-white/80">
              Drop a file here or click to browse
            </span>
          </div>
        ) : (
          <div class="flex flex-col items-center gap-3">
            <TbOutlineCheck size={48} class="text-green-400" />
            <div class="font-medium text-white truncate w-full text-center">
              {file()!.name}
            </div>
            <div class="text-sm text-white/60">
              {formatFileSize(file()!.size)}
            </div>
          </div>
        )}
      </div>

      {/* Send button */}
      {file() && !ticket() && (
        <button
          onClick={handleSend}
          disabled={isSending()}
          class="w-full py-3 px-6 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-purple-500/50 disabled:to-pink-500/50 text-white rounded-xl font-medium transition-all shadow-lg shadow-purple-500/25 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isSending() ? (
            <>
              <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Creating Ticket...
            </>
          ) : (
            <>
              <TbOutlineUpload size={20} />
              Create Ticket
            </>
          )}
        </button>
      )}

      {/* Ticket display */}
      {ticket() && (
        <div class="bg-green-500/10 border border-green-500/20 rounded-xl p-5 space-y-4">
          <div class="flex items-center gap-2 text-green-400">
            <TbOutlineCheck size={20} />
            <span class="font-medium">Ready to Share</span>
          </div>

          <div>
            <label class="text-sm text-white/60 mb-2 block">Share Ticket</label>
            <div class="flex gap-2">
              <input
                type="text"
                value={ticket()}
                readonly
                class="flex-1 bg-black/30 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus:outline-none"
              />
              <button
                onClick={copyTicket}
                class="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg transition-colors"
                aria-label="Copy ticket"
              >
                <TbOutlineCopy size={18} />
              </button>
            </div>
          </div>

          <p class="text-sm text-white/50">
            Share this ticket with the recipient. They can use it to download
            your file.
          </p>
        </div>
      )}
    </div>
  );
}

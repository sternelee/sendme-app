import { createSignal, createMemo, Show } from "solid-js";
import toast from "solid-toast";
import { sendFile, sendFiles } from "../../lib/commands";
import { Motion, Presence } from "solid-motionone";
import {
  TbOutlineUpload,
  TbOutlineCheck,
  TbOutlineCopy,
  TbOutlineFileText,
  TbOutlineX,
  TbOutlineSparkles,
  TbOutlineDevices,
  TbOutlineFolder,
} from "solid-icons/tb";
import DeviceListModal from "../devices/DeviceListModal";

interface Device {
  id: string;
  userId: string;
  platform: string;
  deviceId: string;
  name: string;
  ipAddress: string | null;
  hostname: string | null;
  userAgent: string | null;
  online: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

interface SendTabProps {}

export default function SendTab(_props: SendTabProps) {
  const [file, setFile] = createSignal<File | null>(null);
  const [files, setFiles] = createSignal<File[]>([]);
  const [isFolder, setIsFolder] = createSignal(false);
  const [ticket, setTicket] = createSignal<string>("");
  const [isSending, setIsSending] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;
  let folderInputRef: HTMLInputElement | undefined;

  const dropZoneClass = createMemo(() =>
    isDragging()
      ? "border-purple-500/50 bg-purple-500/10 scale-[1.02]"
      : file() || files().length > 0
        ? "border-green-500/30 bg-green-500/5"
        : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10",
  );

  const hasSelection = createMemo(() => file() || files().length > 0);

  async function handleSend() {
    const currentFile = file();
    const currentFiles = files();

    if (!currentFile && currentFiles.length === 0) return;

    setIsSending(true);
    try {
      let result: string;
      if (isFolder() && currentFiles.length > 0) {
        result = await sendFiles(currentFiles);
      } else if (currentFile) {
        result = await sendFile(currentFile);
      } else {
        throw new Error("No file or folder selected");
      }
      setTicket(result);
      toast.success("Ticket ready to share!");
    } catch (error) {
      console.error("Send failed:", error);
      toast.error("Failed to share file: " + (error as Error).message);
    } finally {
      setIsSending(false);
    }
  }

  function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      setFile(target.files[0]);
      setIsFolder(false);
      setFiles([]);
      setTicket("");
    }
  }

  function handleFolderSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const fileList = Array.from(target.files);
      setFiles(fileList);
      setIsFolder(true);
      setFile(null);
      setTicket("");
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(event.dataTransfer.files);
      if (droppedFiles.length === 1 && !droppedFiles[0].webkitRelativePath) {
        // Single file
        setFile(droppedFiles[0]);
        setIsFolder(false);
        setFiles([]);
      } else {
        // Multiple files (folder or multiple files)
        setFiles(droppedFiles);
        setIsFolder(true);
        setFile(null);
      }
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
    toast.success("Copied to clipboard!");
  }

  function selectFile() {
    fileInputRef?.click();
  }

  function selectFolder() {
    folderInputRef?.click();
  }

  function resetFile() {
    setFile(null);
    setFiles([]);
    setIsFolder(false);
    setTicket("");
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /**
   * Handle sending ticket to a device
   */
  async function handleSendToDevice(device: Device) {
    try {
      const currentFile = file();
      const currentFiles = files();
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: device.deviceId,
          ticket: ticket(),
          filename: isFolder()
            ? currentFiles[0]?.webkitRelativePath?.split("/")[0] || "Folder"
            : currentFile?.name,
          fileSize: isFolder()
            ? currentFiles.reduce((acc, f) => acc + f.size, 0)
            : currentFile?.size,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send ticket");
      }

      toast.success(`Ticket sent to ${device.name}!`);
      setIsDeviceModalOpen(false);
    } catch (error) {
      console.error("Failed to send ticket:", error);
      toast.error("Failed to send ticket: " + (error as Error).message);
    }
  }

  return (
    <div class="space-y-8">
      {/* Header Info */}
      <div class="text-center space-y-2">
        <h2 class="text-2xl font-bold bg-clip-text text-transparent bg-linear-to-r from-white to-white/70">
          Share a File
        </h2>
        <p class="text-white/40 text-sm">
          Everything is encrypted and sent directly peer-to-peer.
        </p>
      </div>

      {/* Main Action Area */}
      <div class="relative group">
        <Presence exitBeforeEnter>
          <Show
            when={!hasSelection()}
            fallback={
              <Motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.2 }}
                class={`relative border-2 border-dashed rounded-3xl p-10 text-center transition-all duration-300 overflow-hidden ${dropZoneClass()}`}
              >
                <div class="flex flex-col items-center gap-4 py-2">
                  <Motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    class="w-16 h-16 rounded-2xl bg-green-500/20 text-green-400 flex items-center justify-center relative"
                  >
                    <Show
                      when={file()}
                      fallback={<TbOutlineFolder size={32} />}
                    >
                      <TbOutlineFileText size={32} />
                    </Show>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        resetFile();
                      }}
                      class="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white/60 flex items-center justify-center backdrop-blur-md border border-white/10"
                    >
                      <TbOutlineX size={12} />
                    </button>
                  </Motion.div>
                  <div class="max-w-xs">
                    <Show
                      when={file()}
                      fallback={
                        <>
                          <p class="font-semibold text-white">
                            {files().length} files selected
                          </p>
                          <p class="text-xs text-white/40 mt-1">
                            {files()[0]?.webkitRelativePath?.split("/")[0] ||
                              "Folder"}
                          </p>
                        </>
                      }
                    >
                      <p class="font-semibold text-white truncate px-4">
                        {file()!.name}
                      </p>
                      <p class="text-xs text-white/40 mt-1">
                        {formatFileSize(file()!.size)}
                      </p>
                    </Show>
                  </div>
                </div>
              </Motion.div>
            }
          >
            <Motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              class={`relative border-2 border-dashed rounded-3xl p-10 text-center transition-all duration-300 overflow-hidden ${dropZoneClass()}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <input
                ref={fileInputRef}
                type="file"
                class="hidden"
                onChange={handleFileSelect}
              />
              <input
                ref={folderInputRef}
                type="file"
                {...({ webkitdirectory: true, directory: true } as any)}
                class="hidden"
                onChange={handleFolderSelect}
              />
              <div class="flex flex-col items-center gap-5 py-4">
                <div class="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-purple-500/20 group-hover:text-purple-400 transition-all duration-500">
                  <TbOutlineUpload
                    size={32}
                    class="opacity-50 group-hover:opacity-100"
                  />
                </div>
                <div class="flex gap-3">
                  <button
                    onClick={selectFile}
                    class="px-6 py-3 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded-xl text-white font-medium transition-all hover:scale-105 active:scale-95"
                  >
                    Choose File
                  </button>
                  <button
                    onClick={selectFolder}
                    class="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/80 font-medium transition-all hover:scale-105 active:scale-95"
                  >
                    Choose Folder
                  </button>
                </div>
                <p class="text-white/40 text-sm">
                  or drag & drop files or folders
                </p>
              </div>
            </Motion.div>
          </Show>
        </Presence>
      </div>

      {/* Action Button */}
      <Show when={hasSelection() && !ticket()}>
        <Motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          hover={{ scale: 1.02 }}
          press={{ scale: 0.98 }}
          onClick={handleSend}
          disabled={isSending()}
          class="w-full py-4 px-6 bg-linear-to-r from-purple-500 via-indigo-500 to-purple-600 hover:hue-rotate-15 disabled:grayscale text-white rounded-2xl font-bold transition-all shadow-xl shadow-purple-500/20 disabled:cursor-not-allowed flex items-center justify-center gap-3 relative overflow-hidden"
        >
          <Show when={isSending()}>
            <div class="absolute inset-0 shimmer opacity-20" />
            <div class="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin" />
            <span>Encapsulating...</span>
          </Show>
          <Show when={!isSending()}>
            <TbOutlineSparkles size={20} class="animate-float" />
            <span>Generate Shared Ticket</span>
          </Show>
        </Motion.button>
      </Show>

      {/* Result Display */}
      <Presence>
        <Show when={ticket()}>
          <Motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            class="glass rounded-3xl p-6 border-indigo-500/20 bg-indigo-500/5 space-y-5"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center">
                  <TbOutlineCheck size={18} />
                </div>
                <span class="font-bold text-white">Target Locked</span>
              </div>
              <span class="text-[10px] font-black uppercase tracking-widest text-white/20">
                Ticket Type: P2P
              </span>
            </div>

            <div class="space-y-3">
              <div class="flex gap-2">
                <div class="flex-1 bg-black/40 border border-white/10 rounded-2xl px-5 py-3.5 text-white text-sm font-mono break-all line-clamp-2 max-h-14.5">
                  {ticket()}
                </div>
                <button
                  onClick={copyTicket}
                  class="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all group active:scale-90"
                  title="Copy ticket"
                >
                  <TbOutlineCopy
                    size={24}
                    class="text-white/60 group-hover:text-white"
                  />
                </button>
                <button
                  onClick={() => setIsDeviceModalOpen(true)}
                  class="p-4 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-2xl transition-all group active:scale-90"
                  title="Send to your device"
                >
                  <TbOutlineDevices
                    size={24}
                    class="text-purple-400 group-hover:text-purple-300"
                  />
                </button>
              </div>
              <p class="text-xs text-white/30 text-center">
                Send this secret ticket to someone to authorize download.
              </p>
            </div>
          </Motion.div>
        </Show>
      </Presence>

      {/* Device List Modal */}
      <DeviceListModal
        isOpen={isDeviceModalOpen()}
        onClose={() => setIsDeviceModalOpen(false)}
        ticket={ticket()}
        showSendButton={true}
        onSendToDevice={handleSendToDevice}
      />
    </div>
  );
}

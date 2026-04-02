import { createSignal, createMemo, Show, For, onCleanup } from "solid-js";
import toast from "solid-toast";
import { sendFile, sendFiles } from "../../lib/commands";
import { useAuth } from "../../lib/contexts/user-clerk";
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
  TbOutlineFile,
  TbOutlineFileTypePdf,
  TbOutlinePhoto,
  TbOutlineVideo,
  TbOutlineFileMusic,
} from "solid-icons/tb";
import DeviceListModal from "../devices/DeviceListModal";
import type { Device } from "../../lib/composables/useWebSocket";

interface SendTabProps {}

// Cache for preview URLs
const previewUrlCache = new Map<string, string>();

function getPreviewUrl(file: File): string {
  // Check cache first
  const cached = previewUrlCache.get(file.name + file.size);
  if (cached) return cached;

  // Generate preview URL for images and videos
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    previewUrlCache.set(file.name + file.size, url);
    return url;
  }
  return '';
}

function getFileIcon(file: File) {
  if (file.type.startsWith('image/')) return TbOutlinePhoto;
  if (file.type.startsWith('video/')) return TbOutlineVideo;
  if (file.type.startsWith('audio/')) return TbOutlineFileMusic;
  if (file.type === 'application/pdf') return TbOutlineFileTypePdf;
  return TbOutlineFile;
}

function isPreviewable(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}

export default function SendTab(_props: SendTabProps) {
  const auth = useAuth();
  const [file, setFile] = createSignal<File | null>(null);
  const [files, setFiles] = createSignal<File[]>([]);
  const [isFolder, setIsFolder] = createSignal(false);
  const [ticket, setTicket] = createSignal<string>("");
  const [isSending, setIsSending] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;
  let folderInputRef: HTMLInputElement | undefined;

  // Clean up preview URLs on unmount
  onCleanup(() => {
    previewUrlCache.forEach(url => URL.revokeObjectURL(url));
    previewUrlCache.clear();
  });

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
                class={`relative border-2 border-dashed rounded-3xl p-6 transition-all duration-300 overflow-hidden ${dropZoneClass()}`}
              >
                {/* Single file preview with thumbnail */}
                <Show when={file()}>
                  <div class="flex flex-col items-center">
                    <Motion.div
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      class="relative group/preview"
                    >
                      {/* Thumbnail preview for images/videos */}
                      <Show when={isPreviewable(file()!)}>
                        <div class="w-32 h-32 rounded-2xl overflow-hidden bg-black/20 mb-4">
                          <img
                            src={getPreviewUrl(file()!)}
                            alt={file()!.name}
                            class="w-full h-full object-cover"
                          />
                        </div>
                      </Show>

                      {/* Icon for non-previewable files */}
                      <Show when={!isPreviewable(file()!)}>
                        <div class="w-32 h-32 rounded-2xl bg-green-500/20 text-green-400 flex items-center justify-center mb-4">
                          <Show
                            when={file()!.type.startsWith('image/')}
                            fallback={
                              <Show
                                when={file()!.type.startsWith('video/')}
                                fallback={
                                  <Show
                                    when={file()!.type === 'application/pdf'}
                                    fallback={<TbOutlineFile size={48} />}
                                  >
                                    <TbOutlineFileTypePdf size={48} />
                                  </Show>
                                }
                              >
                                <TbOutlineVideo size={48} />
                              </Show>
                            }
                          >
                            <TbOutlinePhoto size={48} />
                          </Show>
                        </div>
                      </Show>

                      {/* Remove button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resetFile();
                        }}
                        class="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white/60 flex items-center justify-center backdrop-blur-md border border-white/10 transition-colors"
                      >
                        <TbOutlineX size={14} />
                      </button>
                    </Motion.div>

                    {/* File name and size */}
                    <div class="text-center max-w-xs">
                      <p class="font-semibold text-white truncate px-2">
                        {file()!.name}
                      </p>
                      <p class="text-xs text-white/50 mt-1">
                        {formatFileSize(file()!.size)}
                      </p>
                    </div>
                  </div>
                </Show>

                {/* Multiple files preview */}
                <Show when={files().length > 0 && !file()}>
                  <div class="space-y-4">
                    {/* Header with folder info and remove button */}
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-green-500/20 text-green-400 flex items-center justify-center">
                          <TbOutlineFolder size={20} />
                        </div>
                        <div class="text-left">
                          <p class="font-semibold text-white">
                            {files().length} files selected
                          </p>
                          <p class="text-xs text-white/50">
                            {formatFileSize(files().reduce((acc, f) => acc + f.size, 0))} total
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resetFile();
                        }}
                        class="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                      >
                        <TbOutlineX size={18} />
                      </button>
                    </div>

                    {/* File list with thumbnails */}
                    <div class="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                      <For each={files().slice(0, 8)}>
                        {(f) => (
                          <div class="flex items-center gap-2 p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                            {/* Thumbnail */}
                            <Show when={isPreviewable(f)}>
                              <div class="w-10 h-10 rounded-lg overflow-hidden bg-black/20 flex-shrink-0">
                                <img
                                  src={getPreviewUrl(f)}
                                  alt={f.name}
                                  class="w-full h-full object-cover"
                                />
                              </div>
                            </Show>
                            <Show when={!isPreviewable(f)}>
                              <div class="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 text-white/40">
                                <Show
                                  when={f.type.startsWith('image/')}
                                  fallback={
                                    <Show
                                      when={f.type.startsWith('video/')}
                                      fallback={
                                        <Show
                                          when={f.type === 'application/pdf'}
                                          fallback={<TbOutlineFile size={18} />}
                                        >
                                          <TbOutlineFileTypePdf size={18} />
                                        </Show>
                                      }
                                    >
                                      <TbOutlineVideo size={18} />
                                    </Show>
                                  }
                                >
                                  <TbOutlinePhoto size={18} />
                                </Show>
                              </div>
                            </Show>

                            {/* File info */}
                            <div class="min-w-0 flex-1">
                              <p class="text-xs text-white truncate font-medium">
                                {f.name}
                              </p>
                              <p class="text-[10px] text-white/40">
                                {formatFileSize(f.size)}
                              </p>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>

                    {/* Show more indicator */}
                    <Show when={files().length > 8}>
                      <p class="text-xs text-white/50 text-center">
                        + {files().length - 8} more files
                      </p>
                    </Show>
                  </div>
                </Show>
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
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
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
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
                <Show when={auth.isSignedIn()}>
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
                </Show>
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

import { createSignal, Show, For, onCleanup } from "solid-js";
import toast from "solid-toast";
import { sendFile, sendFiles } from "../../lib/commands";
import { useAuth } from "../../lib/contexts/user-clerk";
import {
  TbOutlineUpload,
  TbOutlineCheck,
  TbOutlineCopy,
  TbOutlineX,
  TbOutlineSparkles,
  TbOutlineDevices,
  TbOutlineFolder,
  TbOutlineFile,
  TbOutlinePhoto,
  TbOutlineVideo,
} from "solid-icons/tb";
import DeviceListModal from "../devices/DeviceListModal";
import type { Device } from "../../lib/composables/useWebSocket";

const previewUrlCache = new Map<string, string>();

function getPreviewUrl(file: File): string {
  const cached = previewUrlCache.get(file.name + file.size);
  if (cached) return cached;
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
    const url = URL.createObjectURL(file);
    previewUrlCache.set(file.name + file.size, url);
    return url;
  }
  return "";
}

function isPreviewable(file: File): boolean {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

export default function SendTab() {
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

  onCleanup(() => {
    previewUrlCache.forEach((url) => URL.revokeObjectURL(url));
    previewUrlCache.clear();
  });

  const hasSelection = () => file() || files().length > 0;

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
        setFile(droppedFiles[0]);
        setIsFolder(false);
        setFiles([]);
      } else {
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

      if (!response.ok) throw new Error("Failed to send ticket");
      toast.success(`Ticket sent to ${device.name}!`);
      setIsDeviceModalOpen(false);
    } catch (error) {
      console.error("Failed to send ticket:", error);
      toast.error("Failed to send ticket: " + (error as Error).message);
    }
  }

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="text-center">
        <h2 class="text-2xl font-bold">Share a File</h2>
        <p class="text-base-content/60 text-sm mt-1">
          Everything is encrypted and sent directly peer-to-peer.
        </p>
      </div>

      {/* Drop Zone / Preview */}
      <Show
        when={hasSelection()}
        fallback={
          <div
            class={`border-2 border-dashed rounded-3xl p-10 text-center transition-all cursor-pointer ${
              isDragging()
                ? "border-primary bg-primary/10"
                : "border-base-300 hover:border-primary/50 hover:bg-base-300/50"
            }`}
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
            <input
              ref={folderInputRef}
              type="file"
              {...({ webkitdirectory: true, directory: true } as any)}
              class="hidden"
              onChange={handleFolderSelect}
            />
            <div class="flex flex-col items-center gap-4">
              <div class="w-16 h-16 rounded-2xl bg-base-300 flex items-center justify-center">
                <TbOutlineUpload size={32} class="opacity-50" />
              </div>
              <div class="flex gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef?.click();
                  }}
                  class="btn btn-primary"
                >
                  Choose File
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    folderInputRef?.click();
                  }}
                  class="btn btn-outline"
                >
                  Choose Folder
                </button>
              </div>
              <p class="text-base-content/40 text-sm">
                or drag & drop files or folders
              </p>
            </div>
          </div>
        }
      >
        <div class="border-2 border-dashed rounded-3xl p-6 bg-base-300/50">
          <Show when={file()}>
            <div class="flex flex-col items-center">
              <div class="relative">
                <Show when={isPreviewable(file()!)}>
                  <div class="w-32 h-32 rounded-2xl overflow-hidden bg-base-300 mb-4">
                    <img
                      src={getPreviewUrl(file()!)}
                      alt={file()!.name}
                      class="w-full h-full object-cover"
                    />
                  </div>
                </Show>
                <Show when={!isPreviewable(file()!)}>
                  <div class="w-32 h-32 rounded-2xl bg-success/20 text-success flex items-center justify-center mb-4">
                    <TbFile size={48} />
                  </div>
                </Show>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    resetFile();
                  }}
                  class="btn btn-circle btn-sm btn-outline absolute -top-2 -right-2"
                >
                  <TbX size={14} />
                </button>
              </div>
              <p class="font-semibold truncate max-w-xs">{file()!.name}</p>
              <p class="text-xs text-base-content/50 mt-1">
                {formatFileSize(file()!.size)}
              </p>
            </div>
          </Show>

          <Show when={files().length > 0 && !file()}>
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-success/20 text-success flex items-center justify-center">
                    <TbFolder size={20} />
                  </div>
                  <div>
                    <p class="font-semibold">{files().length} files selected</p>
                    <p class="text-xs text-base-content/50">
                      {formatFileSize(files().reduce((acc, f) => acc + f.size, 0))} total
                    </p>
                  </div>
                </div>
                <button onClick={resetFile} class="btn btn-ghost btn-sm">
                  <TbX size={18} />
                </button>
              </div>
              <div class="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                <For each={files().slice(0, 8)}>
                  {(f) => (
                    <div class="flex items-center gap-2 p-2 rounded-lg bg-base-300/50">
                      <Show when={isPreviewable(f)}>
                        <div class="w-10 h-10 rounded-lg overflow-hidden bg-base-300 flex-shrink-0">
                          <img
                            src={getPreviewUrl(f)}
                            alt={f.name}
                            class="w-full h-full object-cover"
                          />
                        </div>
                      </Show>
                      <Show when={!isPreviewable(f)}>
                        <div class="w-10 h-10 rounded-lg bg-base-300 flex items-center justify-center text-base-content/40">
                          <TbFile size={18} />
                        </div>
                      </Show>
                      <div class="min-w-0 flex-1">
                        <p class="text-xs truncate font-medium">{f.name}</p>
                        <p class="text-[10px] text-base-content/40">
                          {formatFileSize(f.size)}
                        </p>
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <Show when={files().length > 8}>
                <p class="text-xs text-base-content/50 text-center">
                  + {files().length - 8} more files
                </p>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* Send Button */}
      <Show when={hasSelection() && !ticket()}>
        <button
          onClick={handleSend}
          disabled={isSending()}
          class={`btn btn-primary btn-block btn-lg ${isSending() ? "loading" : ""}`}
        >
          <Show when={!isSending()}>
            <TbOutlineSparkles size={20} /> Generate Shared Ticket
          </Show>
        </button>
      </Show>

      {/* Ticket Result */}
      <Show when={ticket()}>
        <div class="alert alert-success">
          <TbOutlineCheck size={18} />
          <div class="flex-1">
            <p class="font-bold">Target Locked</p>
            <p class="text-xs opacity-60 break-all font-mono mt-1">{ticket()}</p>
          </div>
        </div>
        <div class="flex gap-2">
          <button onClick={copyTicket} class="btn btn-outline flex-1">
            <TbOutlineCopy size={16} /> Copy
          </button>
          <Show when={auth.isSignedIn()}>
            <button
              onClick={() => setIsDeviceModalOpen(true)}
              class="btn btn-outline flex-1"
            >
              <TbOutlineDevices size={16} /> Send to Device
            </button>
          </Show>
        </div>
      </Show>

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

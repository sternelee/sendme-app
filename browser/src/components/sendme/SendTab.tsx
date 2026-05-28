import { Show, For, onCleanup, createSignal, createEffect } from "solid-js";
import toast from "solid-toast";
import { sendFile, sendFiles } from "../../lib/commands";
import { useAuth } from "../../lib/contexts/user-auth";
import { i18n } from "@sendme/shared";
import { useGlobalStore } from "../../lib/store";
import QRCode from "../QRCode";
import {
  useWebSocket,
  type EnrichedFriend,
  getDeviceId,
} from "../../lib/composables/useWebSocket";
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
  TbOutlineMusic,
  TbOutlineFileZip,
  TbOutlineFileText,
  TbOutlineCode,
  TbOutlineUsers,
  TbOutlineQrcode,
  TbOutlineFileTypePdf,
} from "solid-icons/tb";
import DeviceListModal from "../devices/DeviceListModal";
import type { Device } from "../../lib/composables/useWebSocket";

const t = i18n.t;

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

function getFileIcon(file: File) {
  const type = file.type;
  if (type.startsWith("image/")) return TbOutlinePhoto;
  if (type.startsWith("video/")) return TbOutlineVideo;
  if (type.startsWith("audio/")) return TbOutlineMusic;
  if (type === "application/pdf") return TbOutlineFileTypePdf;
  if (
    type === "application/zip" ||
    type === "application/x-zip-compressed" ||
    type === "application/x-rar-compressed" ||
    type === "application/x-tar" ||
    type === "application/gzip"
  )
    return TbOutlineFileZip;
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    type === "application/javascript"
  )
    return TbOutlineFileText;
  if (
    type.includes("code") ||
    file.name.endsWith(".js") ||
    file.name.endsWith(".ts") ||
    file.name.endsWith(".jsx") ||
    file.name.endsWith(".tsx") ||
    file.name.endsWith(".py") ||
    file.name.endsWith(".rs") ||
    file.name.endsWith(".go") ||
    file.name.endsWith(".html") ||
    file.name.endsWith(".css")
  )
    return TbOutlineCode;
  return TbOutlineFile;
}

function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export default function SendTab() {
  const auth = useAuth();
  const { getToken } = useAuth();
  const globalStore = useGlobalStore();
  const { friends } = useWebSocket();
  const [isFriendModalOpen, setIsFriendModalOpen] = createSignal(false);
  const [showQr, setShowQr] = createSignal(false);

  const file = () => globalStore.send.state().file;
  const files = () => globalStore.send.state().files;
  const isFolder = () => globalStore.send.state().isFolder;
  const ticket = () => globalStore.send.state().ticket;
  const isSending = () => globalStore.send.state().isSending;
  const isDragging = () => globalStore.send.state().isDragging;
  const isDeviceModalOpen = () => globalStore.send.state().isDeviceModalOpen;

  const onlineFriends = () =>
    friends().filter(
      (f) => f.status === "accepted" && f.friendDevices.some((d) => d.online),
    );

  // Warn user before closing the tab while a ticket is active (the WASM iroh
  // node must stay alive for the recipient to connect).
  createEffect(() => {
    if (!ticket()) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show a generic message; setting returnValue is required.
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    onCleanup(() => window.removeEventListener("beforeunload", handler));
  });

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

    globalStore.send.setIsSending(true);

    try {
      if (currentFiles.length > 0) {
        const ticket = await sendFiles(currentFiles);
        globalStore.send.setTicket(ticket);
        const folderName =
          currentFiles[0]?.webkitRelativePath?.split("/")[0] || "Folder";
        globalStore.history.addEntry({
          filename: folderName,
          ticket,
          fileSize: currentFiles.reduce((acc, f) => acc + f.size, 0),
          isFolder: true,
          type: "sent",
        });
      } else if (currentFile) {
        const ticket = await sendFile(currentFile);
        globalStore.send.setTicket(ticket);
        globalStore.history.addEntry({
          filename: currentFile.name,
          ticket,
          fileSize: currentFile.size,
          isFolder: false,
          type: "sent",
        });
      }
      toast.success(t("send.sendSuccess"));
    } catch (error) {
      console.error("Failed to send file:", error);
      toast.error(t("send.sendError"));
    } finally {
      globalStore.send.setIsSending(false);
    }
  }

  function handleFileSelect(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const selectedFile = input.files?.[0];
    if (selectedFile) {
      globalStore.send.setFile(selectedFile);
      globalStore.send.setFiles([]);
      globalStore.send.setIsFolder(false);
    }
  }

  function handleFolderSelect(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const selectedFiles = Array.from(input.files || []);
    if (selectedFiles.length > 0) {
      globalStore.send.setFiles(selectedFiles);
      globalStore.send.setFile(null);
      globalStore.send.setIsFolder(true);
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    globalStore.send.setIsDragging(false);

    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    if (droppedFiles.length > 0) {
      globalStore.send.setFile(droppedFiles[0]);
      globalStore.send.setFiles([]);
      globalStore.send.setIsFolder(false);
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    globalStore.send.setIsDragging(true);
  }

  function handleDragLeave() {
    globalStore.send.setIsDragging(false);
  }

  function copyTicket() {
    navigator.clipboard.writeText(ticket());
    toast.success(t("common.copied"));
  }

  function selectFile() {
    fileInputRef?.click();
  }

  async function selectFolder() {
    // Prefer File System Access API for better cross-browser support
    if ("showDirectoryPicker" in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker();
        const files: File[] = [];

        async function traverseDir(handle: any, path: string) {
          for await (const [name, entry] of handle.entries()) {
            if (entry.kind === "file") {
              const fileHandle = entry;
              const file = await fileHandle.getFile();
              // Attach webkitRelativePath for compatibility with existing logic
              Object.defineProperty(file, "webkitRelativePath", {
                value: path ? `${path}/${name}` : name,
                writable: false,
              });
              files.push(file);
            } else if (entry.kind === "directory") {
              await traverseDir(entry, path ? `${path}/${name}` : name);
            }
          }
        }

        await traverseDir(dirHandle, "");
        if (files.length > 0) {
          globalStore.send.setFiles(files);
          globalStore.send.setFile(null);
          globalStore.send.setIsFolder(true);
        }
      } catch (e) {
        // User cancelled or API not available
        console.warn("Directory picker failed, falling back:", e);
        folderInputRef?.click();
      }
    } else {
      folderInputRef?.click();
    }
  }

  function resetFile() {
    globalStore.send.setFile(null);
    globalStore.send.setFiles([]);
    globalStore.send.setIsFolder(false);
    globalStore.send.setTicket("");
    setShowQr(false);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function handleSendToDevice(device: Device) {
    try {
      const token = await getToken();
      const currentFile = file();
      const currentFiles = files();
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token
            ? { Authorization: `Bearer ${token}`, "X-Device-Id": getDeviceId() }
            : { "X-Device-Id": getDeviceId() }),
        },
        body: JSON.stringify({
          deviceId: device.id,
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
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to send ticket");
      }
      toast.success(`Ticket sent to ${device.name}!`);
      globalStore.send.setIsDeviceModalOpen(false);
    } catch (error) {
      console.error("Failed to send ticket:", error);
      toast.error(t("send.sendToDevice") + ": " + (error as Error).message);
    }
  }

  async function handleSendToFriend(friend: EnrichedFriend) {
    try {
      const token = await getToken();
      const currentFile = file();
      const currentFiles = files();
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token
            ? { Authorization: `Bearer ${token}`, "X-Device-Id": getDeviceId() }
            : { "X-Device-Id": getDeviceId() }),
        },
        body: JSON.stringify({
          friendUserId: friend.friend.id,
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
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to send ticket to friend");
      }

      toast.success(`Ticket sent to ${friend.friend.name}!`);
      setIsFriendModalOpen(false);
    } catch (error) {
      console.error("Failed to send ticket to friend:", error);
      toast.error(t("send.sendToDevice") + ": " + (error as Error).message);
    }
  }

  // Get top-level previewable files from folder for grid display
  const previewableFolderFiles = () => {
    if (!isFolder()) return [];
    return files()
      .filter((f) => isPreviewable(f))
      .slice(0, 6);
  };

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="text-center">
        <h2 class="text-2xl font-bold">{t("send.title")}</h2>
        <p class="text-base-content/60 text-sm mt-1">{t("send.subtitle")}</p>
      </div>

      {/* Drop Zone / Preview */}
      <Show
        when={hasSelection()}
        fallback={
          <div
            class={`surface-card p-10 text-center transition-all cursor-pointer border-2 border-dashed ${
              isDragging()
                ? "border-primary bg-primary/10"
                : "border-base-300/60 hover:border-primary/50 hover:bg-base-300/30"
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
            <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4"
            >
              <TbOutlineUpload size={32} class="text-primary/60" />
            </div>
            <p class="text-lg font-semibold mb-1">{t("send.dropFile")}</p>
            <p class="text-sm text-base-content/50 mb-5">{t("send.orClick")}</p>
            <div class="flex justify-center gap-2">
              <button class="btn btn-primary btn-sm rounded-xl">
                <TbOutlineFile size={16} />
                {t("send.selectFile")}
              </button>
              <button
                class="btn btn-outline btn-sm rounded-xl"
                onClick={(e) => {
                  e.stopPropagation();
                  selectFolder();
                }}
              >
                <TbOutlineFolder size={16} />
                {t("send.selectFolder")}
              </button>
            </div>
          </div>
        }
      >
        <div class="surface-card p-5">
          {/* Single file preview */}
          <Show when={!isFolder() && file()}>
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0">
                <Show
                  when={file() && isPreviewable(file()!)}
                  fallback={
                    <div class="w-20 h-20 rounded-2xl bg-base-300 flex items-center justify-center">
                      {(() => {
                        const Icon = getFileIcon(file()!);
                        return <Icon size={32} class="text-base-content/50" />;
                      })()}
                    </div>
                  }
                >
                  <img
                    src={getPreviewUrl(file()!)}
                    alt={file()!.name}
                    class="w-20 h-20 rounded-2xl object-cover"
                  />
                </Show>
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <h3 class="font-semibold truncate">{file()?.name}</h3>
                      <span class="badge badge-xs badge-ghost rounded-md uppercase">
                        {getFileExtension(file()?.name || "")}
                      </span>
                    </div>
                    <p class="text-sm text-base-content/60 mt-1">
                      {file() && formatFileSize(file()!.size)}
                    </p>
                  </div>
                  <button
                    onClick={resetFile}
                    class="btn btn-ghost btn-sm btn-circle flex-shrink-0"
                  >
                    <TbOutlineX size={18} />
                  </button>
                </div>

                <Show when={!ticket()}>
                  <div class="mt-4 flex gap-2">
                    <button
                      onClick={handleSend}
                      disabled={isSending()}
                      class={`btn btn-primary rounded-xl ${isSending() ? "loading" : ""}`}
                    >
                      <TbOutlineSparkles size={18} />
                      {isSending()
                        ? t("send.sending")
                        : t("send.generateTicket")}
                    </button>
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          {/* Folder preview */}
          <Show when={isFolder()}>
            <div class="space-y-4">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h3 class="font-semibold truncate">
                      {files()[0]?.webkitRelativePath?.split("/")[0] ||
                        t("send.folder")}
                    </h3>
                    <span class="badge badge-xs badge-ghost rounded-md">
                      {files().length} files
                    </span>
                  </div>
                  <p class="text-sm text-base-content/60 mt-1">
                    {formatFileSize(
                      files().reduce((acc, f) => acc + f.size, 0),
                    )}
                  </p>
                </div>
                <button
                  onClick={resetFile}
                  class="btn btn-ghost btn-sm btn-circle flex-shrink-0"
                >
                  <TbOutlineX size={18} />
                </button>
              </div>

              {/* Folder file grid */}
              <Show when={previewableFolderFiles().length > 0}>
                <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  <For each={previewableFolderFiles()}>
                    {(f) => (
                      <div class="aspect-square rounded-xl overflow-hidden bg-base-300 relative group">
                        <img
                          src={getPreviewUrl(f)}
                          alt={f.name}
                          class="w-full h-full object-cover"
                          loading="lazy"
                        />
                        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end p-1.5">
                          <span class="text-[10px] text-white opacity-0 group-hover:opacity-100 truncate w-full font-medium drop-shadow">
                            {f.name}
                          </span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Non-previewable file list (first few) */}
              <Show when={files().length > previewableFolderFiles().length}>
                <div class="bg-base-200/50 rounded-2xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
                  <For each={files().slice(0, 8)}>
                    {(f) => {
                      const Icon = getFileIcon(f);
                      return (
                        <div class="flex items-center gap-2 text-sm">
                          <Icon size={14} class="text-base-content/40 flex-shrink-0" />
                          <span class="truncate text-xs text-base-content/70">
                            {f.webkitRelativePath || f.name}
                          </span>
                          <span class="text-xs text-base-content/40 flex-shrink-0 ml-auto">
                            {formatFileSize(f.size)}
                          </span>
                        </div>
                      );
                    }}
                  </For>
                  <Show when={files().length > 8}>
                    <p class="text-xs text-base-content/40 text-center pt-1">
                      +{files().length - 8} more files
                    </p>
                  </Show>
                </div>
              </Show>

              <Show when={!ticket()}>
                <div class="flex gap-2">
                  <button
                    onClick={handleSend}
                    disabled={isSending()}
                    class={`btn btn-primary rounded-xl ${isSending() ? "loading" : ""}`}
                  >
                    <TbOutlineSparkles size={18} />
                    {isSending()
                      ? t("send.sending")
                      : t("send.generateTicket")}
                  </button>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={ticket()}>
            <div class="mt-6 pt-6 border-t border-base-300">
              <div role="alert" class="alert alert-warning mb-4 text-sm">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  />
                </svg>
                <span>{t("send.keepPageOpen")}</span>
              </div>
              <div class="flex items-center justify-between mb-3">
                <h4 class="font-medium">{t("send.ticketReady")}</h4>
                <div class="flex gap-1">
                  <button
                    onClick={() => setShowQr((v) => !v)}
                    class="btn btn-ghost btn-sm rounded-xl"
                  >
                    <TbOutlineQrcode size={16} />
                    {showQr() ? t("send.hideQrCode") : t("send.showQrCode")}
                  </button>
                  <button
                    onClick={copyTicket}
                    class="btn btn-ghost btn-sm rounded-xl"
                  >
                    <TbOutlineCopy size={16} />
                    {t("common.copy")}
                  </button>
                </div>
              </div>
              <div class="mockup-code text-xs break-all mb-4">
                <pre class="whitespace-pre-wrap">
                  <code>{ticket()}</code>
                </pre>
              </div>

              <Show when={showQr()}>
                <div class="flex justify-center mb-4">
                  <div class="bg-white p-3 rounded-2xl inline-block shadow">
                    <QRCode value={ticket()} size={200} />
                  </div>
                </div>
              </Show>

              <div class="flex flex-wrap gap-2">
                <button
                  onClick={resetFile}
                  class="btn btn-outline btn-sm rounded-xl"
                >
                  <TbOutlineX size={16} />
                  {t("send.newTransfer")}
                </button>
                <Show when={auth.isSignedIn()}>
                  <button
                    onClick={() =>
                      globalStore.send.setIsDeviceModalOpen(true)
                    }
                    class="btn btn-outline btn-sm rounded-xl"
                  >
                    <TbOutlineDevices size={16} />
                    {t("send.sendToMyDevices")}
                  </button>
                </Show>

                <Show when={auth.isSignedIn() && onlineFriends().length > 0}>
                  <button
                    onClick={() => setIsFriendModalOpen(true)}
                    class="btn btn-outline btn-sm rounded-xl"
                  >
                    <TbOutlineUsers size={16} />
                    {t("send.sendToFriend")}
                  </button>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      {/* Device List Modal */}
      <DeviceListModal
        isOpen={isDeviceModalOpen()}
        onClose={() => globalStore.send.setIsDeviceModalOpen(false)}
        ticket={ticket()}
        showSendButton={true}
        onSendToDevice={handleSendToDevice}
      />

      {/* Friend Modal */}
      <Show when={isFriendModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div class="bg-base-100 rounded-2xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-xl font-semibold">{t("send.chooseFriend")}</h3>
              <button
                onClick={() => setIsFriendModalOpen(false)}
                class="btn btn-ghost btn-sm btn-circle"
              >
                <TbOutlineX size={18} />
              </button>
            </div>

            <div class="space-y-2">
              <For each={onlineFriends()}>
                {(friend) => (
                  <button
                    onClick={() => handleSendToFriend(friend)}
                    class="w-full p-4 rounded-xl bg-base-200 hover:bg-base-300 transition-colors text-left"
                  >
                    <div class="flex items-center justify-between">
                      <div>
                        <p class="font-medium">{friend.friend.name}</p>
                        <p class="text-sm text-base-content/60">
                          {friend.friend.email}
                        </p>
                      </div>
                      <div class="flex items-center gap-1 text-success text-sm">
                        <div class="w-2 h-2 rounded-full bg-success" />
                        {friend.friendDevices.length} device
                        {friend.friendDevices.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

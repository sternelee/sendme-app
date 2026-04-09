import { Show, For, onCleanup, createSignal } from "solid-js";
import toast from "solid-toast";
import { sendFile, sendFiles } from "../../lib/commands";
import { useAuth } from "../../lib/contexts/user-clerk";
import { i18n } from "../../lib/i18n";
import { useGlobalStore } from "../../lib/store";
import { useWebSocket, type EnrichedFriend, getDeviceId } from "../../lib/composables/useWebSocket";
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
  TbOutlineUsers,
  TbOutlineSend,
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

export default function SendTab() {
  const auth = useAuth();
  const globalStore = useGlobalStore();
  const { friends } = useWebSocket();
  const [isFriendModalOpen, setIsFriendModalOpen] = createSignal(false);

  const file = () => globalStore.send.state().file;
  const files = () => globalStore.send.state().files;
  const isFolder = () => globalStore.send.state().isFolder;
  const ticket = () => globalStore.send.state().ticket;
  const isSending = () => globalStore.send.state().isSending;
  const isDragging = () => globalStore.send.state().isDragging;
  const isDeviceModalOpen = () => globalStore.send.state().isDeviceModalOpen;

  // Filter accepted friends with online devices
  const onlineFriends = () =>
    friends().filter(
      (f) =>
        f.status === "accepted" &&
        f.friendDevices.some((d) => d.online)
    );

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
      let result: string;
      if (isFolder() && currentFiles.length > 0) {
        result = await sendFiles(currentFiles);
      } else if (currentFile) {
        result = await sendFile(currentFile);
      } else {
        throw new Error("No file or folder selected");
      }
      globalStore.send.setTicket(result);
      toast.success(t("send.targetLocked"));
    } catch (error) {
      console.error("Send failed:", error);
      toast.error(t("send.failed") + ": " + (error as Error).message);
    } finally {
      globalStore.send.setIsSending(false);
    }
  }

  function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      globalStore.send.setFile(target.files[0]);
      globalStore.send.setIsFolder(false);
      globalStore.send.setFiles([]);
      globalStore.send.setTicket("");
    }
  }

  function handleFolderSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const fileList = Array.from(target.files);
      globalStore.send.setFiles(fileList);
      globalStore.send.setIsFolder(true);
      globalStore.send.setFile(null);
      globalStore.send.setTicket("");
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    globalStore.send.setIsDragging(false);
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(event.dataTransfer.files);
      if (droppedFiles.length === 1 && !droppedFiles[0].webkitRelativePath) {
        globalStore.send.setFile(droppedFiles[0]);
        globalStore.send.setIsFolder(false);
        globalStore.send.setFiles([]);
      } else {
        globalStore.send.setFiles(droppedFiles);
        globalStore.send.setIsFolder(true);
        globalStore.send.setFile(null);
      }
      globalStore.send.setTicket("");
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

  function resetFile() {
    globalStore.send.setFile(null);
    globalStore.send.setFiles([]);
    globalStore.send.setIsFolder(false);
    globalStore.send.setTicket("");
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
          fromDeviceId: getDeviceId(),
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
      globalStore.send.setIsDeviceModalOpen(false);
    } catch (error) {
      console.error("Failed to send ticket:", error);
      toast.error(t("send.sendToDevice") + ": " + (error as Error).message);
    }
  }

  async function handleSendToFriend(friend: EnrichedFriend) {
    try {
      const currentFile = file();
      const currentFiles = files();
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          friendUserId: friend.friendUserId,
          fromDeviceId: getDeviceId(),
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
        const data = await response.json() as { error?: string };
        throw new Error(data.error || "Failed to send ticket to friend");
      }

      toast.success(`Ticket sent to ${friend.friend.name}!`);
      setIsFriendModalOpen(false);
    } catch (error) {
      console.error("Failed to send ticket to friend:", error);
      toast.error(t("send.sendToDevice") + ": " + (error as Error).message);
    }
  }

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
                  {t("send.chooseFile")}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    folderInputRef?.click();
                  }}
                  class="btn btn-outline"
                >
                  {t("send.chooseFolder")}
                </button>
              </div>
              <p class="text-base-content/40 text-sm">{t("send.dragDrop")}</p>
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
                    <TbOutlineFile size={48} />
                  </div>
                </Show>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    resetFile();
                  }}
                  class="btn btn-circle btn-sm btn-outline absolute -top-2 -right-2"
                >
                  <TbOutlineX size={14} />
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
                    <TbOutlineFolder size={20} />
                  </div>
                  <div>
                    <p class="font-semibold">
                      {files().length} {t("send.filesSelected")}
                    </p>
                    <p class="text-xs text-base-content/50">
                      {formatFileSize(
                        files().reduce((acc, f) => acc + f.size, 0),
                      )}{" "}
                      {t("send.totalSize")}
                    </p>
                  </div>
                </div>
                <button onClick={resetFile} class="btn btn-ghost btn-sm">
                  <TbOutlineX size={18} />
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
                          <TbOutlineFile size={18} />
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
                  + {files().length - 8} {t("send.moreFiles")}
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
            <TbOutlineSparkles size={20} /> {t("send.generateTicket")}
          </Show>
        </button>
      </Show>

      {/* Ticket Result */}
      <Show when={ticket()}>
        <div class="alert alert-success">
          <TbOutlineCheck size={18} />
          <div class="flex-1">
            <p class="font-bold">{t("send.targetLocked")}</p>
            <p class="text-xs opacity-60 break-all font-mono mt-1">
              {ticket()}
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <button onClick={copyTicket} class="btn btn-outline flex-1">
            <TbOutlineCopy size={16} /> {t("send.copy")}
          </button>
          <Show when={auth.isSignedIn()}>
            <button
              onClick={() => globalStore.send.setIsDeviceModalOpen(true)}
              class="btn btn-outline flex-1"
            >
              <TbOutlineDevices size={16} /> {t("send.sendToDevice")}
            </button>
          </Show>
          <Show when={auth.isSignedIn() && onlineFriends().length > 0}>
            <button
              onClick={() => setIsFriendModalOpen(true)}
              class="btn btn-outline flex-1"
            >
              <TbOutlineUsers size={16} /> {t("friends.sendFile")}
            </button>
          </Show>
        </div>
      </Show>

      <DeviceListModal
        isOpen={isDeviceModalOpen()}
        onClose={() => globalStore.send.setIsDeviceModalOpen(false)}
        ticket={ticket()}
        showSendButton={true}
        onSendToDevice={handleSendToDevice}
      />

      {/* Friend Picker Modal */}
      <Show when={isFriendModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            class="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsFriendModalOpen(false)}
          />
          <div class="relative glass rounded-3xl p-6 max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div class="flex items-center justify-between mb-6">
              <div>
                <h2 class="text-xl font-semibold">{t("friends.sendFile")}</h2>
                <p class="text-sm text-base-content/50 mt-1">
                  {onlineFriends().length} friend{onlineFriends().length !== 1 ? "s" : ""} online
                </p>
              </div>
              <button
                onClick={() => setIsFriendModalOpen(false)}
                class="p-2 rounded-xl bg-base-200 hover:bg-base-300 transition-colors"
              >
                <TbOutlineX size={18} />
              </button>
            </div>

            {/* Friends List */}
            <div class="flex-1 overflow-y-auto -mx-2 px-2">
              <Show
                when={onlineFriends().length > 0}
                fallback={
                  <div class="text-center py-12 text-base-content/50">
                    <TbOutlineUsers size={48} class="mx-auto mb-3 opacity-50" />
                    <p class="text-sm">{t("friends.noFriends")}</p>
                  </div>
                }
              >
                <div class="space-y-2">
                  <For each={onlineFriends()}>
                    {(friend) => (
                      <button
                        onClick={() => handleSendToFriend(friend)}
                        class="w-full group relative p-4 rounded-xl border bg-base-200 border-base-300 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
                      >
                        <div class="flex items-center gap-3">
                          {/* Avatar */}
                          <div class="avatar placeholder">
                            <div class="bg-primary text-primary-content rounded-full w-12 h-12">
                              <Show
                                when={friend.friend.image}
                                fallback={
                                  <span class="text-lg">
                                    {friend.friend.name.charAt(0).toUpperCase()}
                                  </span>
                                }
                              >
                                <img
                                  src={friend.friend.image!}
                                  alt={friend.friend.name}
                                />
                              </Show>
                            </div>
                          </div>

                          {/* Info */}
                          <div class="flex-1 min-w-0">
                            <h3 class="font-medium truncate">
                              {friend.friend.name}
                            </h3>
                            <p class="text-xs text-base-content/60 truncate">
                              {friend.friend.email}
                            </p>
                            <Show when={friend.friendDevices.length > 0}>
                              <div class="flex items-center gap-1 mt-1 text-xs text-base-content/40">
                                <For each={friend.friendDevices.slice(0, 3)}>
                                  {(device) => (
                                    <span class="text-[10px] capitalize">
                                      {device.platform}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>

                          {/* Send button */}
                          <div class="flex-shrink-0">
                            <div class="btn btn-primary btn-sm">
                              <TbOutlineSend size={14} />
                            </div>
                          </div>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

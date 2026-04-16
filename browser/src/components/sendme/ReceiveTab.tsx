import { Show, For, createMemo, onCleanup } from "solid-js";
import toast from "solid-toast";
import { receiveFile, downloadFile } from "../../lib/commands";
import { i18n } from "../../lib/i18n";
import { useGlobalStore } from "../../lib/store";
import { useWebSocket } from "../../lib/composables/useWebSocket";
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
  TbOutlineUsers,
} from "solid-icons/tb";
import type { Ticket, EnrichedFriend } from "~/lib/composables/useWebSocket";

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

export default function ReceiveTab(props: { isActive?: boolean }) {
  const globalStore = useGlobalStore();
  // P2-1: Use WebSocket directly — no intermediate useTicketPolling wrapper
  const { friends, tickets: allTickets, markTicketReceived } = useWebSocket();

  const ticket = () => globalStore.receive.state().ticket;
  const isReceiving = () => globalStore.receive.state().isReceiving;
  const receivedFile = () => globalStore.receive.state().receivedFile;
  const error = () => globalStore.receive.state().error;

  // Only surface incoming tickets when this tab is active
  const tickets = createMemo(() => (props.isActive ? allTickets() : []));

  // Create a map of friend's actual user ID → EnrichedFriend for sender lookup.
  // Must use f.friend.id (always the other person's ID), NOT f.friendUserId which
  // is the raw DB column and may point to the current user when they received the request.
  const friendByUserId = createMemo(() => {
    const map = new Map<string, EnrichedFriend>();
    for (const f of friends()) {
      if (f.status === "accepted") {
        map.set(f.friend.id, f);
      }
    }
    return map;
  });

  // P2-4: Blob URL memory management — revoke the previous URL whenever the
  // received file changes, and revoke on component unmount.
  const previewUrl = createMemo(() => {
    const file = receivedFile();
    if (!file || !isPreviewable(file.filename)) return null;
    const mime = getMimeType(file.filename);
    const blob = new Blob([file.data as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    // onCleanup inside createMemo fires before the next recalculation or on dispose
    onCleanup(() => URL.revokeObjectURL(url));
    return url;
  });

  /**
   * Get sender info for a ticket (for friend-to-friend transfers)
   */
  function getSenderName(ticketItem: Ticket) {
    if (ticketItem.fromUserId) {
      const friend = friendByUserId().get(ticketItem.fromUserId);
      if (friend) {
        return friend.friend.name;
      }
    }
    return null; // Own device transfer
  }

  /**
   * Core receive handler.
   * @param overrideTicket - When called from an incoming ticket click, pass the
   *   ticket string directly so we don't rely on the signal having updated yet.
   * @param incomingTicketId - DB UUID of the incoming ticket; when provided the
   *   ticket is marked as received in the backend on successful download.
   */
  async function handleReceive(overrideTicket?: string, incomingTicketId?: string) {
    const ticketValue = (overrideTicket ?? ticket()).trim();
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

      // Mark the incoming ticket as consumed so it disappears from all devices
      if (incomingTicketId) {
        await markTicketReceived(incomingTicketId);
      }

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
    } catch (err) {
      toast.error(t("receive.clipboardError") || "Failed to read clipboard.");
    }
  }

  // P2-3: Auto-start download when user clicks an incoming ticket
  function handleIncomingTicketClick(incomingTicket: Ticket) {
    globalStore.receive.setTicket(incomingTicket.ticket);
    void handleReceive(incomingTicket.ticket, incomingTicket.id);
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
        <h2 class="text-2xl font-bold">{t("receive.title")}</h2>
        <p class="text-base-content/60 text-sm mt-1">{t("receive.subtitle")}</p>
      </div>

      {/* Incoming Tickets */}
      <Show when={tickets().length > 0}>
        <div class="alert alert-warning">
          <TbOutlineSparkles size={18} />
          <div class="flex-1">
            <span class="font-semibold">
              {tickets().length}{" "}
              {t("receive.incomingTickets") || "Incoming Ticket"}
              {tickets().length > 1 ? "s" : ""}
            </span>
            <p class="text-xs opacity-75 mt-0.5">
              Click a ticket below to download it automatically.
            </p>
          </div>
        </div>
        <div class="space-y-2 max-h-40 overflow-y-auto">
          <For each={tickets()}>
            {(incomingTicket) => {
              const senderName = getSenderName(incomingTicket);
              const isFromFriend = !!senderName;

              return (
                <button
                  type="button"
                  disabled={isReceiving()}
                  class="flex items-center gap-3 p-3 rounded-xl bg-base-300/50 hover:bg-base-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors w-full text-left"
                  onClick={() => handleIncomingTicketClick(incomingTicket)}
                >
                  <div class={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    isFromFriend ? "bg-secondary/20 text-secondary" : "bg-primary/20 text-primary"
                  }`}>
                    {isFromFriend ? <TbOutlineUsers size={16} /> : <TbOutlineDeviceMobile size={16} />}
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">
                      {incomingTicket.filename || t("receive.unnamedFile") || "Unnamed file"}
                    </p>
                    <p class="text-xs text-base-content/50">
                      {isFromFriend
                        ? `From ${senderName}`
                        : "From your device"}
                      {" • "}
                      {incomingTicket.fileSize
                        ? `${(incomingTicket.fileSize / 1024 / 1024).toFixed(2)} MB`
                        : t("receive.unknownSize") || "Unknown size"}
                    </p>
                  </div>
                  <TbOutlineDownload size={16} class="text-primary shrink-0" />
                </button>
              );
            }}
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
            onInput={(e) => globalStore.receive.setTicket(e.currentTarget.value)}
            placeholder={t("receive.pasteTicket")}
            class="grow font-mono text-sm"
            disabled={isReceiving()}
          />
          <button
            onClick={pasteTicket}
            class="btn btn-ghost btn-sm"
            disabled={isReceiving()}
            title={t("receive.pasteFromClipboard") || "Paste from clipboard"}
          >
            <TbOutlineClipboard size={16} />
          </button>
        </label>
      </div>

      <button
        onClick={() => void handleReceive()}
        disabled={!ticket().trim() || isReceiving()}
        class={`btn btn-primary btn-block ${isReceiving() ? "loading" : ""}`}
      >
        <Show when={!isReceiving()}>
          <TbOutlineDownload size={18} /> {t("receive.receiveFile")}
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
            <p class="font-bold">{t("receive.downloadComplete")}</p>
            <p class="text-sm font-mono truncate">{receivedFile()!.filename}</p>
            <p class="text-xs opacity-60">
              {formatFileSize(receivedFile()!.data)} •{" "}
              {t("receive.readyToDownload") || "Ready to download"}
            </p>
          </div>
        </div>

        <Show when={previewUrl()}>
          <div class="w-full h-48 rounded-2xl overflow-hidden bg-base-300">
            <img
              src={previewUrl()!}
              alt={receivedFile()!.filename}
              class="w-full h-full object-contain"
            />
          </div>
        </Show>

        <button
          onClick={downloadReceivedFile}
          class="btn btn-success btn-block"
        >
          <TbOutlineDownload size={18} /> {t("receive.saveFile")}
        </button>
      </Show>
    </div>
  );
}

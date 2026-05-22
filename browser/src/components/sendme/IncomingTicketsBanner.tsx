/**
 * IncomingTicketsBanner
 * Global banner displayed above the tab navigation whenever there are
 * pending incoming tickets. Handles download + dismiss without requiring
 * the user to switch to the Receive tab.
 */

import { Show, For, createMemo, createSignal } from "solid-js";
import toast from "solid-toast";
import { receiveFile, downloadFile } from "../../lib/commands";
import { i18n } from "@sendme/shared";
import { useWebSocket } from "../../lib/composables/useWebSocket";
import type { Ticket, EnrichedFriend } from "../../lib/composables/useWebSocket";
import {
  TbOutlineDownload,
  TbOutlineSparkles,
  TbOutlineDeviceMobile,
  TbOutlineUsers,
  TbOutlineX,
  TbOutlineCheck,
} from "solid-icons/tb";

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

export default function IncomingTicketsBanner() {
  const { tickets: allTickets, markTicketReceived, deleteTicket, friends } =
    useWebSocket();

  // IDs dismissed locally (before the WS pushes the update)
  const [dismissedIds, setDismissedIds] = createSignal<Set<string>>(new Set());
  // ID currently being downloaded
  const [receivingId, setReceivingId] = createSignal<string | null>(null);
  // Downloaded files keyed by ticket ID, ready for save
  const [downloadedFiles, setDownloadedFiles] = createSignal<
    Record<string, { filename: string; data: Uint8Array }>
  >({});

  const tickets = createMemo(() => {
    const dismissed = dismissedIds();
    return allTickets().filter((t) => !dismissed.has(t.id));
  });

  // Map friend userId → EnrichedFriend for sender lookup
  const friendByUserId = createMemo(() => {
    const map = new Map<string, EnrichedFriend>();
    for (const f of friends()) {
      if (f.status === "accepted") map.set(f.friend.id, f);
    }
    return map;
  });

  function getSenderName(ticket: Ticket): string | null {
    if (ticket.fromUserId) {
      return friendByUserId().get(ticket.fromUserId)?.friend.name ?? null;
    }
    return null;
  }

  async function handleDownload(ticket: Ticket) {
    if (receivingId()) return;
    setReceivingId(ticket.id);
    try {
      const result = await receiveFile(ticket.ticket);
      // Mark consumed on server + remove from local list
      await markTicketReceived(ticket.id);
      setDismissedIds((prev) => new Set([...prev, ticket.id]));
      // Store downloaded file so user can save it
      setDownloadedFiles((prev) => ({ ...prev, [ticket.id]: result }));
      // Auto-trigger browser save
      downloadFile(result.data, result.filename);
      toast.success(t("receive.downloadComplete"));
    } catch (err) {
      toast.error((err as Error).message || t("receive.invalidTicket"));
    } finally {
      setReceivingId(null);
    }
  }

  async function handleDismiss(ticket: Ticket) {
    const ok = await deleteTicket(ticket.id);
    if (ok) {
      setDismissedIds((prev) => new Set([...prev, ticket.id]));
    } else {
      toast.error(t("receive.dismissFailed") || "Failed to dismiss ticket");
    }
  }

  async function handleDismissAll() {
    const list = tickets();
    const results = await Promise.allSettled(list.map((t) => deleteTicket(t.id)));
    const failed = results.filter((r) => r.status === "rejected" || !r.value).length;
    setDismissedIds((prev) => new Set([...prev, ...list.map((t) => t.id)]));
    if (failed > 0) {
      toast.error(
        (t("receive.dismissFailed") || "Failed to dismiss") +
          ` ${failed} ticket${failed > 1 ? "s" : ""}`,
      );
    }
  }

  function saveFile(id: string) {
    const file = downloadedFiles()[id];
    if (!file) return;
    downloadFile(file.data, file.filename);
    toast.success(t("receive.saveFile") + ": " + file.filename);
  }

  return (
    <Show when={tickets().length > 0}>
      <div class="w-full space-y-2">
        {/* Header bar */}
        <div class="alert alert-warning rounded-xl py-2 px-3">
          <TbOutlineSparkles size={18} class="shrink-0" />
          <span class="flex-1 font-semibold text-sm">
            {tickets().length}{" "}
            {t("receive.incomingTickets") || "Incoming Ticket"}
            {tickets().length > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={handleDismissAll}
            class="btn btn-ghost btn-xs btn-circle shrink-0"
            title={t("common.close") || "Close all"}
          >
            <TbOutlineX size={16} />
          </button>
        </div>

        {/* Ticket list */}
        <div class="space-y-1 max-h-48 overflow-y-auto">
          <For each={tickets()}>
            {(ticket) => {
              const senderName = getSenderName(ticket);
              const isFromFriend = !!senderName;
              const isThisReceiving = () => receivingId() === ticket.id;
              const isAnyReceiving = () => receivingId() !== null;

              return (
                <div class="flex items-center gap-3 p-3 rounded-xl bg-base-300/50 group">
                  {/* Icon */}
                  <div
                    class={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isFromFriend
                        ? "bg-secondary/20 text-secondary"
                        : "bg-primary/20 text-primary"
                    }`}
                  >
                    {isFromFriend ? (
                      <TbOutlineUsers size={16} />
                    ) : (
                      <TbOutlineDeviceMobile size={16} />
                    )}
                  </div>

                  {/* File info */}
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">
                      {ticket.filename || t("receive.unnamedFile") || "Unnamed file"}
                    </p>
                    <p class="text-xs text-base-content/50">
                      {isFromFriend ? `From ${senderName}` : "From your device"}
                      {" • "}
                      {ticket.fileSize
                        ? `${(ticket.fileSize / 1024 / 1024).toFixed(2)} MB`
                        : t("receive.unknownSize") || "Unknown size"}
                    </p>
                  </div>

                  {/* Download / spinner / done */}
                  <Show
                    when={!isThisReceiving()}
                    fallback={
                      <span class="loading loading-spinner loading-xs text-primary shrink-0" />
                    }
                  >
                    <button
                      type="button"
                      disabled={isAnyReceiving()}
                      onClick={() => handleDownload(ticket)}
                      class="btn btn-primary btn-xs rounded-lg shrink-0 disabled:opacity-40"
                      title={t("receive.receiveFile") || "Download"}
                    >
                      <TbOutlineDownload size={14} />
                      {t("receive.receiveFile") || "Download"}
                    </button>
                  </Show>

                  {/* Dismiss */}
                  <button
                    type="button"
                    disabled={isThisReceiving()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDismiss(ticket);
                    }}
                    class="btn btn-ghost btn-xs btn-circle shrink-0 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
                    title={t("common.cancel") || "Dismiss"}
                  >
                    <TbOutlineX size={14} />
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
}

import { For, Show, createSignal, createMemo } from "solid-js";
import toast from "solid-toast";
import { useAuth } from "../../lib/contexts/user-auth";
import { i18n } from "@sendme/shared";
import { useGlobalStore } from "../../lib/store";
import { getDeviceId } from "../../lib/composables/useWebSocket";
import {
  TbOutlineHistory,
  TbOutlineCopy,
  TbOutlineTrash,
  TbOutlineFile,
  TbOutlineFolder,
  TbOutlineUpload,
  TbOutlineArrowUp,
  TbOutlineArrowDown,
} from "solid-icons/tb";

const t = i18n.t;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t("friends.justNow") || "Just now";
  if (diffMins < 60) return `${diffMins}m ${t("friends.ago") || "ago"}`;
  if (diffHours < 24) return `${diffHours}h ${t("friends.ago") || "ago"}`;
  if (diffDays < 7) return `${diffDays}d ${t("friends.ago") || "ago"}`;
  return d.toLocaleDateString();
}

export default function HistoryTab() {
  const globalStore = useGlobalStore();
  const { getToken, isSignedIn } = useAuth();
  const [filter, setFilter] = createSignal<"all" | "sent" | "received">("all");

  const entries = () => globalStore.history.state().entries;

  const filteredEntries = createMemo(() => {
    const f = filter();
    if (f === "all") return entries();
    return entries().filter((e) => e.type === f);
  });

  const stats = createMemo(() => {
    const all = entries();
    return {
      total: all.length,
      sent: all.filter((e) => e.type === "sent").length,
      received: all.filter((e) => e.type === "received").length,
    };
  });

  function copyTicket(ticket: string) {
    navigator.clipboard.writeText(ticket);
    toast.success(t("common.copied"));
  }

  async function removeEntry(id: string, ticket: string) {
    if (isSignedIn()) {
      try {
        const token = await getToken();
        await fetch("/api/tickets", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...(token
              ? { Authorization: `Bearer ${token}`, "X-Device-Id": getDeviceId() }
              : { "X-Device-Id": getDeviceId() }),
          },
          body: JSON.stringify({ ticket }),
        });
      } catch (err) {
        console.warn("[HistoryTab] Failed to delete ticket from DB:", err);
      }
    }
    globalStore.history.removeEntry(id);
  }

  async function clearAll() {
    if (isSignedIn()) {
      const token = await getToken();
      await Promise.allSettled(
        entries().map((e) =>
          fetch("/api/tickets", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...(token
                ? { Authorization: `Bearer ${token}`, "X-Device-Id": getDeviceId() }
                : { "X-Device-Id": getDeviceId() }),
            },
            body: JSON.stringify({ ticket: e.ticket }),
          }),
        ),
      );
    }
    globalStore.history.clear();
  }

  return (
    <div class="space-y-4">
      {/* Header */}
      <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3"
      >
        <div>
          <p class="section-label"
          >{t("history.title")}</p>
          <p class="text-base-content/65 mt-1 text-sm"
          >
            {stats().total > 0
              ? `${stats().total} ${t("common.files") || "files"} (${stats().sent} sent, ${stats().received} received)`
              : t("history.receivedFiles")}
          </p>
        </div>
        <Show when={entries().length > 0}
        >
          <button
            onClick={clearAll}
            class="btn btn-ghost btn-sm text-error rounded-xl self-start sm:self-auto"
            title={t("history.clear")}
          >
            <TbOutlineTrash size={16} />
            {t("history.clear")}
          </button>
        </Show>
      </div>

      {/* Filter Tabs */}
      <Show when={entries().length > 0}
      >
        <div class="flex gap-1 p-1 bg-base-200/60 rounded-xl w-fit"
        >
          {[
            { key: "all" as const, label: "All", count: stats().total },
            { key: "sent" as const, label: t("history.sent") || "Sent", count: stats().sent },
            { key: "received" as const, label: t("history.received") || "Received", count: stats().received },
          ].map((f) => (
            <button
              class={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter() === f.key
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/50 hover:text-base-content"
              }`}
              onClick={() => setFilter(f.key)}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </Show>

      {/* Empty state */}
      <Show
        when={filteredEntries().length > 0}
        fallback={
          <div class="surface-card flex flex-col items-center justify-center py-16 text-center"
          >
            <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4"
            >
              <TbOutlineHistory size={32} class="text-primary/60" />
            </div>
            <p class="text-base-content/80 font-semibold text-lg"
            >{t("history.empty")}</p>
            <p class="text-sm text-base-content/50 mt-1 max-w-xs"
            >
              {t("history.emptyDesc")}
            </p>
            <a
              href="/app"
              class="btn btn-primary btn-sm rounded-xl mt-5 gap-2"
            >
              <TbOutlineUpload size={16} />
              {t("common.send")}
            </a>
          </div>
        }
      >
        <div class="space-y-2"
        >
          <For each={filteredEntries()}
          >
            {(entry) => (
              <div class="surface-card p-4"
              >
                <div class="flex items-center gap-3"
                >
                  {/* File Icon */}
                  <div class={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                    entry.type === "sent"
                      ? "bg-primary/12 text-primary"
                      : "bg-secondary/12 text-secondary"
                  }`}
                  >
                    <Show
                      when={entry.isFolder}
                      fallback={
                        <TbOutlineFile size={20} />
                      }
                    >
                      <TbOutlineFolder size={20} />
                    </Show>
                  </div>

                  {/* Info */}
                  <div class="flex-1 min-w-0"
                  >
                    <div class="flex items-center gap-2"
                    >
                      <p class="font-semibold text-sm truncate"
                      >{entry.filename}</p>
                      <span class={`badge badge-xs rounded-md ${
                        entry.type === "sent"
                          ? "badge-primary"
                          : "badge-secondary"
                      }`}
                      >
                        {entry.type === "sent" ? (
                          <TbOutlineArrowUp size={10} class="mr-0.5" />
                        ) : (
                          <TbOutlineArrowDown size={10} class="mr-0.5" />
                        )}
                        {entry.type}
                      </span>
                    </div>
                    <p class="text-xs text-base-content/50 mt-0.5"
                    >
                      {formatFileSize(entry.fileSize)} · {formatTime(entry.timestamp)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div class="flex gap-0.5 flex-shrink-0"
                  >
                    <button
                      onClick={() => copyTicket(entry.ticket)}
                      class="btn btn-ghost btn-sm btn-circle"
                      title={t("history.copyTicket")}
                    >
                      <TbOutlineCopy size={16} />
                    </button>
                    <button
                      onClick={() => removeEntry(entry.id, entry.ticket)}
                      class="btn btn-ghost btn-sm btn-circle text-error"
                      title={t("common.clear")}
                    >
                      <TbOutlineTrash size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

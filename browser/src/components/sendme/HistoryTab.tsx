import { For, Show } from "solid-js";
import toast from "solid-toast";
import { useAuth } from "../../lib/contexts/user-auth";
import { i18n } from "../../lib/i18n";
import { useGlobalStore } from "../../lib/store";
import { getDeviceId } from "../../lib/composables/useWebSocket";
import {
  TbOutlineHistory,
  TbOutlineCopy,
  TbOutlineTrash,
  TbOutlineFile,
  TbOutlineFolder,
} from "solid-icons/tb";

const t = i18n.t;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString();
}

export default function HistoryTab() {
  const globalStore = useGlobalStore();
  const { getToken, isSignedIn } = useAuth();

  const entries = () => globalStore.history.state().entries;

  function copyTicket(ticket: string) {
    navigator.clipboard.writeText(ticket);
    toast.success(t("common.copied"));
  }

  async function removeEntry(id: string, ticket: string) {
    // Best-effort: delete DB record if signed in
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
        // Non-fatal — log and continue with local removal
        console.warn("[HistoryTab] Failed to delete ticket from DB:", err);
      }
    }
    globalStore.history.removeEntry(id);
  }

  async function clearAll() {
    // Delete all DB records in parallel (best-effort)
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
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-bold">{t("history.title")}</h2>
          <p class="text-base-content/60 text-sm mt-1">
            {t("history.subtitle")}
          </p>
        </div>
        <Show when={entries().length > 0}>
          <button
            onClick={clearAll}
            class="btn btn-ghost btn-sm text-error"
            title={t("history.clear")}
          >
            <TbOutlineTrash size={16} />
            {t("history.clear")}
          </button>
        </Show>      </div>

      {/* Empty state */}
      <Show
        when={entries().length > 0}
        fallback={
          <div class="text-center py-12">
            <TbOutlineHistory size={48} class="mx-auto mb-4 opacity-40" />
            <p class="text-base-content/60">{t("history.empty")}</p>
            <p class="text-sm text-base-content/40 mt-1">
              {t("history.emptyDesc")}
            </p>
          </div>
        }
      >
        <div class="space-y-2">
          <For each={entries()}>
            {(entry) => (
              <div class="card bg-base-100 shadow-sm">
                <div class="card-body p-4">
                  <div class="flex items-start gap-3">
                    <div class="flex-shrink-0 w-10 h-10 rounded-xl bg-base-200 flex items-center justify-center">
                      <Show
                        when={entry.isFolder}
                        fallback={
                          <TbOutlineFile
                            size={20}
                            class="text-base-content/50"
                          />
                        }
                      >
                        <TbOutlineFolder
                          size={20}
                          class="text-base-content/50"
                        />
                      </Show>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium truncate">{entry.filename}</p>
                      <p class="text-xs text-base-content/50 mt-0.5">
                        {formatFileSize(entry.fileSize)} •{" "}
                        {formatTime(entry.timestamp)}
                      </p>
                    </div>
                    <div class="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => copyTicket(entry.ticket)}
                        class="btn btn-ghost btn-xs"
                        title={t("history.copyTicket")}
                      >
                        <TbOutlineCopy size={14} />
                        {t("history.copyTicket")}
                      </button>
                      <button
                        onClick={() => removeEntry(entry.id, entry.ticket)}
                        class="btn btn-ghost btn-xs text-error"
                        title={t("common.clear")}
                      >
                        <TbOutlineTrash size={14} />
                      </button>
                    </div>
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

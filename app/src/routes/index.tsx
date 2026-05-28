import {
  createSignal,
  onMount,
  onCleanup,
  Show,
  Switch,
  Match,
  createEffect,
} from "solid-js";
import { platform } from "@tauri-apps/plugin-os";
import { listen } from "@tauri-apps/api/event";

import { Motion, Presence } from "solid-motionone";
import { Send, History, Settings, X } from "lucide-solid";
import { Toaster, toast } from "solid-sonner";
import { i18n } from "@sendme/shared";

import { requestCloudApi, getCloudApiUrl } from "~/lib/cloud-api";
import { useGlobalStore } from "~/lib/store";
import { IncomingReminderStack } from "~/lib/components/IncomingReminderStack";
import { ShareTicketCard } from "~/lib/components/ShareTicketCard";
import type { PendingReceiveCard } from "~/lib/transfer-ui";
import { SplashScreen } from "~/lib/components/SplashScreen";
import { TransferTab } from "~/components/TransferTab";
import { HistoryPanel } from "~/components/HistoryPanel";
import { SettingsPanel } from "~/components/SettingsPanel";
import {
  get_transfers,
  start_nearby_discovery,
  stop_nearby_discovery,
  accept_incoming,
  decline_incoming,
  accept_cloud_ticket,
  decline_cloud_ticket,
  type IncomingRequest,
  type NearbyTransferState,
  type CloudTicket,
} from "~/bindings";
import { copyToClipboard, nativeShare } from "~/lib/utils";
import type {
  ProgressUpdate,
  ShareSubTab,
  Tab,
  Theme,
  Transfer,
  TransferMode,
} from "~/lib/types";

const t = i18n.t;

export default function MainPage() {
  const globalStore = useGlobalStore();

  const [isMobile, setIsMobile] = createSignal(false);

  const [isInitializing, setIsInitializing] = createSignal(true);
  const [, setTheme] = createSignal<Theme>("system");
  const [activeTab, setActiveTab] = createSignal<Tab>("transfer");
  const [transferMode, setTransferMode] = createSignal<TransferMode>("send");
  const [shareSubTab, setShareSubTab] = createSignal<ShareSubTab>("nearby");
  const [showQrCode, setShowQrCode] = createSignal(false);
  const [pendingReceiveCards, setPendingReceiveCards] = createSignal<
    PendingReceiveCard[]
  >([]);
  const [transfers, setTransfers] = createSignal<Transfer[]>([]);

  function setTransferView(mode: TransferMode) {
    setTransferMode(mode);
    globalStore.send.setIsTextMode(mode === "text");
  }

  function applyTheme(newTheme: Theme) {
    const root = window.document.documentElement;
    root.removeAttribute("data-theme");
    if (newTheme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.setAttribute("data-theme", systemTheme);
    } else {
      root.setAttribute("data-theme", newTheme);
    }
  }

  function setThemeValue(newTheme: Theme) {
    applyTheme(newTheme);
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  }

  async function loadTransfers() {
    try {
      const loaded = await get_transfers();
      setTransfers(loaded.sort((a, b) => b.created_at - a.created_at));
    } catch (e) {}
  }

  async function handleReshare(transfer: Transfer) {
    if (transfer.transfer_type !== "send") return;
    const ticket = transfer.ticket;
    if (!ticket) {
      toast.error(t("common.ticketNotFound"));
      return;
    }
    globalStore.send.setPath(transfer.path);
    globalStore.send.setTicket(ticket);
    const QRCode = (await import("qrcode")).default;
    globalStore.send.setTicketQrCode(
      await QRCode.toDataURL(ticket, {
        errorCorrectionLevel: "H",
        width: 280,
      }),
    );
    setShowQrCode(!isMobile());
    globalStore.send.setShowReshareModal(true);
  }

  function openReceiveWorkspace() {
    setTransferView("receive");
    setActiveTab("transfer");
  }

  async function handleAcceptNearbyRequest() {
    const request = globalStore.nearbyReceive.state().incomingRequest;
    if (!request) return;
    try {
      await accept_incoming(
        request.id,
        globalStore.receive.state().outputDir || undefined,
      );
      globalStore.nearbyReceive.setTransferState("receiving");
      openReceiveWorkspace();
    } catch (e) {
      toast.error(`${t("nearby.acceptFailed")}: ${e}`);
    }
  }

  async function handleDeclineNearbyRequest() {
    const request = globalStore.nearbyReceive.state().incomingRequest;
    if (!request) return;
    try {
      await decline_incoming(request.id);
      globalStore.nearbyReceive.setIncomingRequest(null);
      globalStore.nearbyReceive.setTransferState("idle");
    } catch (e) {
      toast.error(`${t("nearby.declineFailed")}: ${e}`);
    }
  }

  async function handleAcceptCloudTicket(ticketId: string) {
    const ticket = globalStore.cloudReceive
      .state()
      .tickets.find((item) => item.id === ticketId);
    if (!ticket) return;

    try {
      globalStore.cloudReceive.setCurrentTicket(ticket);
      globalStore.cloudReceive.setTransferState("receiving");
      const transferId = await accept_cloud_ticket(
        ticket.id,
        globalStore.receive.state().outputDir || undefined,
      );
      setPendingReceiveCards((prev) => [
        {
          id: transferId,
          title:
            ticket.filename?.trim() || ticket.senderName?.trim() || ticket.id,
          total: ticket.fileSize,
          lastTime: Date.now(),
        },
        ...prev.filter((item) => item.id !== transferId),
      ]);
      globalStore.cloudReceive.setTickets(
        globalStore.cloudReceive
          .state()
          .tickets.filter((item) => item.id !== ticket.id),
      );
      globalStore.cloudReceive.setCurrentTicket(null);
      globalStore.cloudReceive.setTransferState("idle");
      openReceiveWorkspace();
      toast.success(t("receive.connecting"));
      requestCloudApi(getCloudApiUrl(`/api/tickets/${ticket.id}/receive`), {
        method: "POST",
      }).catch(() => {});
    } catch (e) {
      globalStore.cloudReceive.setError(String(e));
      globalStore.cloudReceive.setCurrentTicket(null);
      globalStore.cloudReceive.setTransferState("idle");
      toast.error(`${t("receive.receiveError")}: ${e}`);
    }
  }

  async function handleDeclineCloudTicket(ticketId: string) {
    try {
      await decline_cloud_ticket(ticketId);
      const remaining = globalStore.cloudReceive
        .state()
        .tickets.filter((item) => item.id !== ticketId);
      globalStore.cloudReceive.setTickets(remaining);
      globalStore.cloudReceive.setCurrentTicket(remaining[0] ?? null);
      globalStore.cloudReceive.setTransferState(
        remaining.length > 0 ? "review" : "idle",
      );
    } catch (e) {
      toast.error(`${t("receive.dismissFailed")}: ${e}`);
    }
  }

  onMount(async () => {
    try {
      const p = platform();
      setIsMobile(p === "android" || p === "ios");
    } catch (e) {}

    const savedTheme = localStorage.getItem("theme") as Theme | null;
    setThemeValue(savedTheme || "system");

    const savedOutputDir = localStorage.getItem("receive-output-dir");
    if (savedOutputDir) globalStore.receive.setOutputDir(savedOutputDir);

    setIsInitializing(false);

    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
      Promise.race([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out`)), ms),
        ),
      ]);

    void withTimeout(loadTransfers(), 5000, "loadTransfers").catch((e) =>
      console.warn("[init] loadTransfers failed:", e),
    );
    void withTimeout(
      start_nearby_discovery(),
      5000,
      "start_nearby_discovery",
    ).catch((e) => console.warn("[init] start_nearby_discovery failed:", e));

    const unlistenNearby = await listen<IncomingRequest>(
      "incoming_nearby_request",
      (event) => {
        globalStore.nearbyReceive.setIncomingRequest(event.payload);
        globalStore.nearbyReceive.setTransferProgress(null);
        globalStore.nearbyReceive.setError(null);
        globalStore.nearbyReceive.setTransferState("review");
      },
    );

    const unlistenNearbyCancel = await listen<{ requestId: string }>(
      "nearby_request_cancelled",
      (event) => {
        if (
          globalStore.nearbyReceive.state().incomingRequest?.id ===
          event.payload.requestId
        ) {
          globalStore.nearbyReceive.setIncomingRequest(null);
          globalStore.nearbyReceive.setTransferState("idle");
          toast.info(t("nearby.senderCancelled"));
        }
      },
    );

    const unlistenNearbyDecline = await listen<{ requestId: string }>(
      "nearby_request_declined",
      (event) => {
        if (
          globalStore.nearbyReceive.state().incomingRequest?.id ===
          event.payload.requestId
        ) {
          globalStore.nearbyReceive.setIncomingRequest(null);
          globalStore.nearbyReceive.setTransferProgress(null);
          globalStore.nearbyReceive.setTransferState("idle");
          toast.info(t("nearby.requestDeclined"));
        }
      },
    );

    const unlistenNearbyReceive = await listen<NearbyTransferState>(
      "nearby_receive_state",
      (event) => {
        const payload = event.payload;
        if (payload.progress) {
          globalStore.nearbyReceive.setTransferProgress(payload.progress);
        }
        if (payload.state === "receiving") {
          globalStore.nearbyReceive.setTransferState("receiving");
          return;
        }
        if (payload.state === "done") {
          globalStore.nearbyReceive.setIncomingRequest(null);
          globalStore.nearbyReceive.setTransferProgress(null);
          globalStore.nearbyReceive.setTransferState("idle");
          toast.success(payload.message ?? t("nearby.transferComplete"));
          return;
        }
        if (payload.state === "error") {
          globalStore.nearbyReceive.setIncomingRequest(null);
          globalStore.nearbyReceive.setTransferProgress(null);
          globalStore.nearbyReceive.setTransferState("idle");
          globalStore.nearbyReceive.setError(
            payload.message ?? t("nearby.transferFailed"),
          );
          toast.error(payload.message ?? t("nearby.transferFailed"));
        }
      },
    );
    const unlistenProgress = await listen<ProgressUpdate>(
      "progress",
      (event) => {
        const transferId = event.payload.data.transfer_id;
        setPendingReceiveCards((prev) =>
          prev.filter((item) => item.id !== transferId),
        );
      },
    );

    const unlistenCloudTickets = await listen<CloudTicket[]>(
      "cloud_tickets_updated",
      (event) => {
        const tickets = event.payload.filter(
          (t) => (t.status ?? "pending") === "pending",
        );
        globalStore.cloudReceive.setTickets(tickets);
        if (tickets.length === 0) {
          globalStore.cloudReceive.setCurrentTicket(null);
          if (globalStore.cloudReceive.state().transferState !== "receiving") {
            globalStore.cloudReceive.setTransferState("idle");
          }
          return;
        }
        if (globalStore.cloudReceive.state().transferState !== "receiving") {
          globalStore.cloudReceive.setCurrentTicket(tickets[0]);
          globalStore.cloudReceive.setTransferState("review");
        }
      },
    );

    onCleanup(() => {
      unlistenNearby();
      unlistenNearbyCancel();
      unlistenNearbyDecline();
      unlistenNearbyReceive();
      unlistenCloudTickets();
      unlistenProgress();
      stop_nearby_discovery().catch(() => {});
    });
  });

  createEffect(() => {
    const outputDir = globalStore.receive.state().outputDir;
    if (!outputDir) {
      localStorage.removeItem("receive-output-dir");
      return;
    }
    localStorage.setItem("receive-output-dir", outputDir);
  });

  return (
    <div class="app-shell text-base-content flex min-h-screen flex-col">
      <Toaster position="top-center" />

      <Show when={isInitializing()}>
        <SplashScreen stage="shell" />
      </Show>

      <Show when={!isMobile()}>
        <header class="border-base-300/60 bg-base-100/90 sticky top-0 z-40 border-b backdrop-blur-xl">
          <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <h1 class="text-lg font-bold tracking-tight">
              {t("common.appName")}
            </h1>
            <div class="flex gap-1">
              <button
                class={`btn btn-sm rounded-md ${activeTab() === "transfer" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setActiveTab("transfer")}
              >
                {t("common.transfer")}
              </button>
              <button
                class={`btn btn-sm rounded-md ${activeTab() === "history" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setActiveTab("history")}
              >
                {t("common.history")}
              </button>
              <button
                class={`btn btn-sm rounded-md ${activeTab() === "settings" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setActiveTab("settings")}
              >
                {t("common.settings")}
              </button>
            </div>
          </div>
        </header>
      </Show>

      <main
        class={`safe-area-top-offset mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 overflow-auto px-4 ${isMobile() ? "pb-28" : "pb-8"}`}
      >
        <Presence exitBeforeEnter>
          <Switch>
            <Match when={activeTab() === "transfer"}>
              <Motion.div
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                class="space-y-6"
              >
                <TransferTab
                  transferMode={transferMode()}
                  setTransferView={setTransferView}
                  shareSubTab={shareSubTab()}
                  setShareSubTab={setShareSubTab}
                  isMobile={isMobile()}
                  showQrCode={showQrCode()}
                  setShowQrCode={setShowQrCode}
                  onCopy={copyToClipboard}
                  onShare={nativeShare}
                  pendingReceiveCards={pendingReceiveCards()}
                  onTransferComplete={loadTransfers}
                />
              </Motion.div>
            </Match>

            <Match when={activeTab() === "history"}>
              <Motion.div
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                class="space-y-4"
              >
                <HistoryPanel
                  transfers={transfers()}
                  onReload={loadTransfers}
                  onReshare={handleReshare}
                />
              </Motion.div>
            </Match>

            <Match when={activeTab() === "settings"}>
              <Motion.div
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                class="space-y-4"
              >
                <SettingsPanel />
              </Motion.div>
            </Match>
          </Switch>
        </Presence>
      </main>
      <IncomingReminderStack
        isMobile={isMobile()}
        nearbyRequest={globalStore.nearbyReceive.state().incomingRequest}
        cloudTickets={globalStore.cloudReceive.state().tickets}
        onOpenReceive={openReceiveWorkspace}
        onAcceptNearby={handleAcceptNearbyRequest}
        onDeclineNearby={handleDeclineNearbyRequest}
        onAcceptCloud={handleAcceptCloudTicket}
        onDeclineCloud={handleDeclineCloudTicket}
      />

      {/* Reshare Modal */}
      <Show when={globalStore.send.state().showReshareModal}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div class="card bg-base-200 w-full max-w-sm">
            <div class="card-body gap-4">
              <div class="flex items-center justify-between">
                <h3 class="card-title text-base">{t("common.share")}</h3>
                <button
                  onClick={() => globalStore.send.setShowReshareModal(false)}
                  class="btn btn-ghost btn-sm btn-circle"
                >
                  <X size={18} />
                </button>
              </div>
              <ShareTicketCard
                ticket={globalStore.send.state().ticket}
                qrCode={globalStore.send.state().ticketQrCode}
                isMobile={isMobile()}
                showQrCode={showQrCode()}
                setShowQrCode={setShowQrCode}
                title={t("common.share")}
                onCopy={copyToClipboard}
                onShare={nativeShare}
              />
            </div>
          </div>
        </div>
      </Show>

      <Show when={isMobile()}>
        <nav class="dock dock-md border-base-300 bg-base-100/85 border-t backdrop-blur-xl">
          <button
            class={`dock-label ${activeTab() === "transfer" ? "active" : ""}`}
            onClick={() => setActiveTab("transfer")}
          >
            <Send size={24} />
            <span>{t("common.transfer")}</span>
          </button>
          <button
            class={`dock-label ${activeTab() === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            <History size={24} />
            <span>{t("common.history")}</span>
          </button>
          <button
            class={`dock-label ${activeTab() === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Settings size={24} />
            <span>{t("common.settings")}</span>
          </button>
        </nav>
      </Show>
    </div>
  );
}

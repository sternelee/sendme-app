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
import { Send, History, Settings, X, RefreshCw } from "lucide-solid";
import { Toaster, toast } from "solid-sonner";
import { i18n } from "@sendme/shared";

import { requestCloudApi, getCloudApiUrl } from "~/lib/cloud-api";
import { debugError, debugInfo } from "~/lib/debug-log";
import { useGlobalStore } from "~/lib/store";
import { IncomingReminderStack } from "~/lib/components/IncomingReminderStack";
import { ShareTicketCard } from "~/lib/components/ShareTicketCard";
import { EnhancedHistoryPanel } from "~/lib/components/EnhancedHistoryPanel";
import type { PendingReceiveCard } from "~/lib/transfer-ui";
import { SplashScreen } from "~/lib/components/SplashScreen";
import { TransferTab } from "~/components/TransferTab";
import { SettingsPanel } from "~/components/SettingsPanel";
import { PeerSyncTab } from "~/components/PeerSyncTab";
import {
  get_file_size,
  get_transfers,
  start_nearby_discovery,
  stop_nearby_discovery,
  accept_incoming,
  decline_incoming,
  accept_cloud_ticket,
  decline_cloud_ticket,
  start_window_drag,
  type IncomingRequest,
  type NearbyTransferState,
  type CloudTicket,
  type PeerSyncSyncRecord,
  peersync_get_status,
  get_transport_routing_policy,
  set_transport_routing_policy,
} from "~/bindings";
import { copyToClipboard, nativeShare } from "~/lib/utils";
import { triggerHaptic } from "~/lib/haptics";
import type {
  ProgressUpdate,
  ShareSubTab,
  Tab,
  Theme,
  Transfer,
  TransferMode,
  TransferRoutingPolicy,
} from "~/lib/types";

const t = i18n.t;
const NEARBY_AUTOSTART_DELAY_MS = 8000;

export default function MainPage() {
  const globalStore = useGlobalStore();

  const [isMobile, setIsMobile] = createSignal(false);

  const [isInitializing, setIsInitializing] = createSignal(true);
  const [, setTheme] = createSignal<Theme>("system");
  const [activeTab, setActiveTab] = createSignal<Tab>("transfer");
  const [transferMode, setTransferMode] = createSignal<TransferMode>("send");
  const [shareSubTab, setShareSubTab] = createSignal<ShareSubTab>("nearby");
  const [routingPolicy, setRoutingPolicy] =
    createSignal<TransferRoutingPolicy>("auto");
  const [showQrCode, setShowQrCode] = createSignal(false);
  const [pendingReceiveCards, setPendingReceiveCards] = createSignal<
    PendingReceiveCard[]
  >([]);
  const [transfers, setTransfers] = createSignal<Transfer[]>([]);

  function setTransferView(mode: TransferMode) {
    setTransferMode(mode);
    globalStore.send.setIsTextMode(mode === "text");
  }

  const EXPLICIT_THEMES = [
    "light",
    "dark",
    "sunset",
    "black",
    "synthwave",
    "abyss",
    "luxury",
  ] as const;

  function resolveTheme(newTheme: Theme) {
    if (newTheme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return newTheme;
  }

  function applyTheme(newTheme: Theme) {
    const root = window.document.documentElement;
    root.setAttribute("data-theme", resolveTheme(newTheme));
  }

  function setThemeValue(newTheme: Theme) {
    applyTheme(newTheme);
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  }

  // 带触觉反馈的标签切换
  function handleTabChange(tab: Tab) {
    triggerHaptic("light");
    setActiveTab(tab);
  }

  // 带触觉反馈的传输模式切换
  function handleTransferView(mode: TransferMode) {
    triggerHaptic("selection");
    setTransferView(mode);
  }

  let lastWindowDragAt = 0;

  function handleDesktopWindowDrag(
    event: MouseEvent & { currentTarget: HTMLElement; target: Element },
  ) {
    if (isMobile() || event.button !== 0 || event.buttons !== 1) return;

    const target = event.target as HTMLElement;
    if (
      target.closest(
        "button,a,input,textarea,select,[role='button'],[data-no-window-drag]",
      )
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastWindowDragAt < 350) return;
    lastWindowDragAt = now;

    event.preventDefault();
    void start_window_drag().catch((e) => {
      console.warn("[window] Failed to start native drag:", e);
    });
  }

  async function loadTransfers() {
    try {
      const loaded = await get_transfers();
      setTransfers(loaded.sort((a, b) => b.created_at - a.created_at));
    } catch (e) {
      console.warn("[init] loadTransfers failed:", e);
    }
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
    const request = globalStore.nearbyReceive.state().incomingRequests[0];
    if (!request) return;
    try {
      globalStore.nearbyReceive.setPendingRequestState(request.id, "accepting");
      await accept_incoming(
        request.id,
        globalStore.receive.state().outputDir || undefined,
      );
      globalStore.nearbyReceive.setActiveRequestId(request.id);
      globalStore.nearbyReceive.setTransferState("receiving");
      openReceiveWorkspace();
    } catch (e) {
      globalStore.nearbyReceive.setPendingRequestState(request.id, "pending");
      toast.error(`${t("nearby.acceptFailed")}: ${e}`);
    }
  }

  async function handleDeclineNearbyRequest() {
    const request = globalStore.nearbyReceive.state().incomingRequests[0];
    if (!request) return;
    try {
      globalStore.nearbyReceive.setPendingRequestState(request.id, "declining");
      await decline_incoming(request.id);
      if (
        globalStore.nearbyReceive
          .state()
          .incomingRequests.some((item) => item.id === request.id)
      ) {
        globalStore.nearbyReceive.removeIncomingRequest(request.id);
      }
      const remaining = globalStore.nearbyReceive.state().incomingRequests;
      globalStore.nearbyReceive.setTransferState(
        remaining.length > 0 ? "review" : "idle",
      );
    } catch (e) {
      globalStore.nearbyReceive.setPendingRequestState(request.id, "pending");
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
      const p = await platform();
      setIsMobile(p === "android" || p === "ios");
    } catch (e) {
      console.warn("[init] platform detection failed:", e);
    }

    const savedTheme = localStorage.getItem("theme");
    const validTheme: Theme =
      savedTheme &&
      (savedTheme === "system" ||
        (EXPLICIT_THEMES as readonly string[]).includes(savedTheme))
        ? (savedTheme as Theme)
        : "system";
    setThemeValue(validTheme);

    const savedOutputDir = localStorage.getItem("receive-output-dir");
    if (savedOutputDir) globalStore.receive.setOutputDir(savedOutputDir);
    const savedRoutingPolicy = localStorage.getItem(
      "transfer-routing-policy",
    ) as TransferRoutingPolicy | null;
    if (savedRoutingPolicy) {
      setRoutingPolicy(savedRoutingPolicy);
      set_transport_routing_policy(savedRoutingPolicy).catch((error) =>
        debugError("routing-policy", "Failed to set saved routing policy", error),
      );
    } else {
      get_transport_routing_policy()
        .then((policy) => setRoutingPolicy(policy))
        .catch((error) =>
          debugError("routing-policy", "Failed to read backend routing policy", error),
        );
    }

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
    const nearbyAutostartTimer = setTimeout(() => {
      debugInfo(
        "init",
        `Starting nearby discovery after ${NEARBY_AUTOSTART_DELAY_MS}ms delay`,
      );
      void withTimeout(
        start_nearby_discovery(),
        8000,
        "start_nearby_discovery",
      ).catch((e) => {
        debugError("init", "start_nearby_discovery failed", e);
        console.warn("[init] start_nearby_discovery failed:", e);
      });
    }, NEARBY_AUTOSTART_DELAY_MS);

    const unlistenNearby = await listen<IncomingRequest>(
      "incoming_nearby_request",
      (event) => {
        if (
          globalStore.nearbyReceive
            .state()
            .incomingRequests.some((item) => item.id === event.payload.id)
        ) {
          return;
        }
        globalStore.nearbyReceive.addIncomingRequest(event.payload);
        globalStore.nearbyReceive.setTransferProgress(null);
        globalStore.nearbyReceive.setError(null);
        if (globalStore.nearbyReceive.state().transferState === "idle") {
          globalStore.nearbyReceive.setTransferState("review");
        }
      },
    );

    const unlistenNearbyCancel = await listen<{ requestId: string }>(
      "nearby_request_cancelled",
      (event) => {
        const requestId = event.payload.requestId;
        const state = globalStore.nearbyReceive.state();
        if (!state.incomingRequests.some((item) => item.id === requestId)) {
          return;
        }

        const wasActive = state.activeRequestId === requestId;
        globalStore.nearbyReceive.removeIncomingRequest(requestId);
        const remaining = globalStore.nearbyReceive.state().incomingRequests;
        if (wasActive) {
          globalStore.nearbyReceive.setTransferProgress(null);
          globalStore.nearbyReceive.setTransferState(
            remaining.length > 0 ? "review" : "idle",
          );
        } else if (
          remaining.length === 0 &&
          globalStore.nearbyReceive.state().transferState !== "receiving"
        ) {
          globalStore.nearbyReceive.setTransferState("idle");
        }
        toast.info(t("nearby.senderCancelled"));
      },
    );

    const unlistenNearbyDecline = await listen<{ requestId: string }>(
      "nearby_request_declined",
      (event) => {
        const requestId = event.payload.requestId;
        if (
          !globalStore.nearbyReceive
            .state()
            .incomingRequests.some((item) => item.id === requestId)
        ) {
          return;
        }

        globalStore.nearbyReceive.removeIncomingRequest(requestId);
        globalStore.nearbyReceive.setTransferProgress(null);
        const remaining = globalStore.nearbyReceive.state().incomingRequests;
        globalStore.nearbyReceive.setTransferState(
          remaining.length > 0 ? "review" : "idle",
        );
        toast.info(t("nearby.requestDeclined"));
      },
    );

    const unlistenNearbyReceive = await listen<NearbyTransferState>(
      "nearby_receive_state",
      (event) => {
        const payload = event.payload;
        if (
          payload.requestId &&
          globalStore.nearbyReceive.state().activeRequestId &&
          payload.requestId !==
            globalStore.nearbyReceive.state().activeRequestId
        ) {
          return;
        }

        if (payload.progress) {
          globalStore.nearbyReceive.setTransferProgress(payload.progress);
        }
        if (payload.state === "receiving") {
          globalStore.nearbyReceive.setTransferState("receiving");
          return;
        }
        if (payload.state === "done") {
          if (payload.requestId) {
            globalStore.nearbyReceive.removeIncomingRequest(payload.requestId);
          }
          globalStore.nearbyReceive.setTransferProgress(null);
          const remaining = globalStore.nearbyReceive.state().incomingRequests;
          globalStore.nearbyReceive.setTransferState(
            remaining.length > 0 ? "review" : "idle",
          );
          toast.success(payload.message ?? t("nearby.transferComplete"));
          return;
        }
        if (payload.state === "error") {
          if (payload.requestId) {
            globalStore.nearbyReceive.removeIncomingRequest(payload.requestId);
          }
          globalStore.nearbyReceive.setTransferProgress(null);
          const remaining = globalStore.nearbyReceive.state().incomingRequests;
          globalStore.nearbyReceive.setTransferState(
            remaining.length > 0 ? "review" : "idle",
          );
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

    const unlistenShowSettings = await listen("show-settings", () => {
      setActiveTab("settings");
    });

    // PeerSync engine events from the backend broadcast channel. Keep the
    // store in sync without a full refetch on every tick.
    const unlistenPeerSync = await listen<{
      type: "logged" | "stopped" | "warning" | "status_refresh";
      record?: PeerSyncSyncRecord;
      message?: string;
    }>("peersync-event", (event) => {
      const ev = event.payload;
      if (ev.type === "logged" && ev.record) {
        globalStore.peerSync.appendLog(ev.record);
      } else if (ev.type === "stopped") {
        globalStore.peerSync.setEngineRunning(false);
      } else if (ev.type === "warning" && ev.message) {
        globalStore.peerSync.setLastError(ev.message);
        toast.warning(`PeerSync: ${ev.message}`);
      }
      // status_refresh is also emitted as a no-payload signal on a
      // separate event name so the frontend can re-fetch status without
      // parsing the full event envelope.
    });

    const unlistenPeerSyncRefresh = await listen("peersync-status-refresh", () => {
      peersync_get_status()
        .then((s) => {
          globalStore.peerSync.setStatus(s.status);
          globalStore.peerSync.setEngineRunning(s.engineRunning);
          if (s.ticket) globalStore.peerSync.setTicket(s.ticket);
        })
        .catch((e) => debugError("peersync-refresh", "status refresh failed", e));
    });

    const unlistenDockFile = await listen<string>(
      "dock-file-opened",
      async (event) => {
        const url = event.payload;
        const path = url.startsWith("file://")
          ? decodeURIComponent(url.slice(7))
          : url;
        if (!path) return;

        try {
          const size = await get_file_size(path);
          const name = path.split(/[\\/]/).pop() || "file";
          globalStore.send.clearFiles();
          globalStore.send.addFiles([{ path, name, size }]);
          globalStore.send.setPath(path);
          globalStore.send.setFileSize(size);
          globalStore.send.setTicket("");
          globalStore.send.setTicketQrCode("");
          globalStore.send.setIsFolder(false);
          setTransferView("send");
          setActiveTab("transfer");
          toast.success(t("send.fileSelected"));
        } catch (e) {
          console.warn("[dock] Failed to load dropped file:", e);
          toast.error(t("send.fileSelectError"));
        }
      },
    );

    onCleanup(() => {
      clearTimeout(nearbyAutostartTimer);
      unlistenNearby();
      unlistenNearbyCancel();
      unlistenNearbyDecline();
      unlistenNearbyReceive();
      unlistenCloudTickets();
      unlistenProgress();
      unlistenShowSettings();
      unlistenDockFile();
      unlistenPeerSync();
      unlistenPeerSyncRefresh();
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

  createEffect(() => {
    const policy = routingPolicy();
    localStorage.setItem("transfer-routing-policy", policy);
    set_transport_routing_policy(policy).catch((error) =>
      debugError("routing-policy", "Failed to sync routing policy", error),
    );
  });

  return (
    <div class="app-shell text-base-content flex min-h-screen flex-col">
      <Toaster position="top-center" />

      <Show when={isInitializing()}>
        <SplashScreen stage="shell" />
      </Show>

      <Show when={!isMobile()}>
        <header
          class="border-base-300/60 bg-base-100/90 sticky top-0 z-40 cursor-default border-b backdrop-blur-xl"
          onMouseDown={handleDesktopWindowDrag}
        >
          <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <h1 class="text-lg font-bold tracking-tight opacity-0">
              {t("common.appName")}
            </h1>
            <div class="flex gap-1">
              <Motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                class={`btn btn-sm rounded-md ${activeTab() === "transfer" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => handleTabChange("transfer")}
              >
                {t("common.transfer")}
              </Motion.button>
              <Motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                class={`btn btn-sm rounded-md ${activeTab() === "history" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => handleTabChange("history")}
              >
                {t("common.history")}
              </Motion.button>
              <Motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                class={`btn btn-sm rounded-md ${activeTab() === "settings" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => handleTabChange("settings")}
              >
                {t("common.settings")}
              </Motion.button>
              <Motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                class={`btn btn-sm rounded-md ${activeTab() === "peersync" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => handleTabChange("peersync")}
              >
                <RefreshCw size={12} />
                {t("common.peersync")}
              </Motion.button>
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
                  setTransferView={handleTransferView}
                  shareSubTab={shareSubTab()}
                  setShareSubTab={setShareSubTab}
                  routingPolicy={routingPolicy()}
                  setRoutingPolicy={setRoutingPolicy}
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
                <EnhancedHistoryPanel
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

            <Match when={activeTab() === "peersync"}>
              <Motion.div
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                class="space-y-4"
              >
                <PeerSyncTab />
              </Motion.div>
            </Match>
          </Switch>
        </Presence>
      </main>
      <IncomingReminderStack
        isMobile={isMobile()}
        nearbyRequests={globalStore.nearbyReceive.state().incomingRequests}
        cloudTickets={globalStore.cloudReceive.state().tickets}
        onOpenReceive={openReceiveWorkspace}
        onAcceptNearby={handleAcceptNearbyRequest}
        onDeclineNearby={handleDeclineNearbyRequest}
        onAcceptCloud={handleAcceptCloudTicket}
        onDeclineCloud={handleDeclineCloudTicket}
      />

      {/* Reshare Modal */}
      <Show when={globalStore.send.state().showReshareModal}>
        <dialog class="modal modal-open">
          <div class="modal-box">
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-bold">{t("common.share")}</h3>
              <button
                onClick={() => globalStore.send.setShowReshareModal(false)}
                class="btn btn-ghost btn-sm btn-circle"
                aria-label={t("common.close")}
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
          <form method="dialog" class="modal-backdrop">
            <button
              onClick={() => globalStore.send.setShowReshareModal(false)}
              aria-label={t("common.close")}
            >
              close
            </button>
          </form>
        </dialog>
      </Show>

      <Show when={isMobile()}>
        <nav class="dock dock-md border-base-300 bg-base-100/85 border-t backdrop-blur-xl">
          <Motion.button
            whileTap={{ scale: 0.9 }}
            class={`dock-label ${activeTab() === "transfer" ? "active" : ""}`}
            onClick={() => handleTabChange("transfer")}
          >
            <Send size={24} />
            <span>{t("common.transfer")}</span>
          </Motion.button>
          <Motion.button
            whileTap={{ scale: 0.9 }}
            class={`dock-label ${activeTab() === "history" ? "active" : ""}`}
            onClick={() => handleTabChange("history")}
          >
            <History size={24} />
            <span>{t("common.history")}</span>
          </Motion.button>
          <Motion.button
            whileTap={{ scale: 0.9 }}
            class={`dock-label ${activeTab() === "settings" ? "active" : ""}`}
            onClick={() => handleTabChange("settings")}
          >
            <Settings size={24} />
            <span>{t("common.settings")}</span>
          </Motion.button>
          <Motion.button
            whileTap={{ scale: 0.9 }}
            class={`dock-label ${activeTab() === "peersync" ? "active" : ""}`}
            onClick={() => handleTabChange("peersync")}
          >
            <RefreshCw size={24} />
            <span>{t("common.peersync")}</span>
          </Motion.button>
        </nav>
      </Show>
    </div>
  );
}

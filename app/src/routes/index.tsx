import {
  createSignal,
  onMount,
  onCleanup,
  For,
  Show,
  Switch,
  Match,
  createEffect,
  createMemo,
} from "solid-js";
import {
  send_file,
  send_text,
  receive_file,
  cancel_transfer,
  delete_transfer,
  get_transfers,
  clear_transfers,
  open_received_file,
  pick_directory,
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
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  readText as readClipboardText,
  writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";
import { platform } from "@tauri-apps/plugin-os";
import {
  scan,
  Format,
  checkPermissions,
  requestPermissions,
} from "@tauri-apps/plugin-barcode-scanner";
import QRCode from "qrcode";
import { Motion, Presence } from "solid-motionone";
import {
  SendIcon,
  Copy,
  Share2,
  Download,
  Send,
  X,
  RefreshCw,
  FileText,
  FileImage,
  FileArchive,
  FileCode,
  History,
  Settings,
  Scan,
  Trash2,
  Shield,
  Zap,
  User,
  LogOut,
  Radio,
  Smartphone,
  ChevronDown,
  Folder,
  Link2,
} from "lucide-solid";

import { Toaster, toast } from "solid-sonner";
import {
  formatDate,
  formatFileSize,
  getDisplayName,
  getFileIcon,
  getTransferStatus,
} from "~/lib/utils";
import { useAuth } from "~/lib/auth";
import { requestCloudApi, getCloudApiUrl } from "~/lib/cloud-api";
import { ThemeSwitcher } from "~/lib/ThemeSwitcher";
import { LanguageSwitcher } from "~/lib/LanguageSwitcher";
import { i18n } from "~/lib/i18n";
import { useGlobalStore } from "~/lib/store";
import { IncomingRequestCard } from "~/lib/components/IncomingRequestCard";
import { SplashScreen } from "~/lib/components/SplashScreen";
import { TransferProgress } from "~/lib/components/TransferProgress";
import NearbyPage from "~/routes/nearby";
import FriendsPage from "~/routes/friends";
import DevicesPage from "~/routes/devices";
import { DropZone } from "~/lib/components/DropZone";


const t = i18n.t;

interface Transfer {
  id: string;
  transfer_type: string;
  path: string;
  status: string;
  created_at: number;
  ticket?: string;
}

interface ProgressData {
  transfer_id: string;
  [key: string]: any;
}

interface ProgressUpdate {
  event_type: string;
  data: ProgressData & { transfer_id: string };
}

type Theme = "light" | "dark" | "system";
type Tab = "transfer" | "history" | "settings";
type ShareSubTab = "nearby" | "devices" | "friends";
type TransferMode = "send" | "receive" | "text";

const ticketTypes = [
  { value: "id", label: "ID Only" },
  { value: "relay", label: "Relay" },
  { value: "addresses", label: "Addresses" },
  { value: "relay_and_addresses", label: "Relay + Addresses" },
];


function ProgressBorder(props: { percent: () => number; children: any }) {
  let barRef: HTMLDivElement | undefined;
  createEffect(() => {
    if (barRef) {
      barRef.style.width = `${Math.max(0, Math.min(100, Math.round(props.percent())))}%`;
    }
  });
  return (
    <div class="border-base-300/60 bg-base-100 relative overflow-hidden rounded-3xl border">
      <div
        ref={barRef}
        class="bg-secondary absolute bottom-0 left-0 h-[3px] transition-[width] duration-300 ease-out"
      />
      {props.children}
    </div>
  );
}

export default function MainPage() {
  const auth = useAuth();
  const globalStore = useGlobalStore();

  const [isMobile, setIsMobile] = createSignal(false);
  const [showQrCode, setShowQrCode] = createSignal(false);
  const [isSmallWindow, setIsSmallWindow] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [, setTheme] = createSignal<Theme>("system");
  const [activeTab, setActiveTab] = createSignal<Tab>("transfer");
  const [transferMode, setTransferMode] = createSignal<TransferMode>("send");
  const [shareSubTab, setShareSubTab] = createSignal<ShareSubTab>("nearby");

  const sendPath = () => globalStore.send.state().path;
  const sendTicketType = () => globalStore.send.state().ticketType;
  const sendTicket = () => globalStore.send.state().ticket;
  const sendTicketQrCode = () => globalStore.send.state().ticketQrCode;
  const isSending = () => globalStore.send.state().isSending;
  const isTextMode = () => transferMode() === "text";
  const textContent = () => globalStore.send.state().textContent;
  const sendIsFolder = () => globalStore.send.state().isFolder;

  const receiveTicket = () => globalStore.receive.state().ticket;
  const receiveOutputDir = () => globalStore.receive.state().outputDir;
  const isReceiving = () => globalStore.receive.state().isReceiving;

  const [currentReceivingId, setCurrentReceivingId] = createSignal<
    string | null
  >(null);

  const [transfers, setTransfers] = createSignal<Transfer[]>([]);
  const [progressData, setProgressData] = createSignal<
    Record<string, ProgressData>
  >({});

  const receiveProgressPercent = createMemo(() => {
    const id = currentReceivingId();
    if (!id) return 0;
    const data = progressData()[id];
    if (!data?.progress) return 0;
    if (data.progress.type === "completed") return 100;
    // Download in progress: use live offset/total, capped at 99%
    if (data.progress.type === "downloading" && data.progress.total > 0) {
      return Math.min((data.progress.offset / data.progress.total) * 100, 99);
    }
    // Export phase: download is done, show 99% until completed
    if (
      data.event_type === "export" ||
      data.progress.type === "file_progress" ||
      data.progress.type === "file_started" ||
      data.progress.type === "file_completed" ||
      data.progress.type === "started"
    ) {
      return 99;
    }
    return 0;
  });

  function setTransferView(mode: TransferMode) {
    setTransferMode(mode);
    globalStore.send.setIsTextMode(mode === "text");
  }

  function renderTransferTitleIcon() {
    if (transferMode() === "receive") {
      return <Download size={18} class="text-secondary" />;
    }
    if (transferMode() === "text") {
      return <FileText size={18} class="text-accent" />;
    }

    return <Send size={18} class="text-primary" />;
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


  async function handleSend() {
    if (isTextMode() && !textContent().trim()) return;
    if (!isTextMode() && !sendPath()) return;

    globalStore.send.setIsSending(true);
    try {
      const result = isTextMode()
        ? await send_text({
            text: textContent().trim(),
            ticket_type: sendTicketType(),
          })
        : await send_file({ path: sendPath(), ticket_type: sendTicketType() });
      globalStore.send.setTicket(result);
      globalStore.send.setTicketQrCode(
        await QRCode.toDataURL(result, {
          errorCorrectionLevel: "H",
          width: 280,
        }),
      );
      setShowQrCode(true);
      await loadTransfers();
    } catch (e) {
      toast.error(t("send.failed") + `: ${e}`);
    } finally {
      globalStore.send.setIsSending(false);
    }
  }

  async function selectOutputDirectory() {
    try {
      if (isMobile()) {
        const result = await pick_directory();
        globalStore.receive.setOutputDir(result.uri);
      } else {
        const selected = await open({ multiple: false, directory: true });
        if (selected && typeof selected === "string")
          globalStore.receive.setOutputDir(selected);
      }
    } catch (e) {}
  }

  async function handleGenerateTicket() {
    if (isTextMode() && !textContent().trim()) return;
    if (!isTextMode() && !sendPath()) return;

    globalStore.send.setIsSending(true);
    try {
      const result = isTextMode()
        ? await send_text({
            text: textContent().trim(),
            ticket_type: sendTicketType(),
          })
        : await send_file({ path: sendPath(), ticket_type: sendTicketType() });
      globalStore.send.setTicket(result);
      globalStore.send.setTicketQrCode(
        await QRCode.toDataURL(result, {
          errorCorrectionLevel: "H",
          width: 280,
        }),
      );
      await loadTransfers();
    } catch (e) {
      toast.error(t("send.failed") + `: ${e}`);
    } finally {
      globalStore.send.setIsSending(false);
    }
  }

  async function handleReceive() {
    const ticket = receiveTicket().trim();
    if (!ticket) return;

    globalStore.receive.setIsReceiving(true);
    try {
      await receive_file({
        ticket,
        output_dir: receiveOutputDir() || undefined,
      });
      await loadTransfers();
      globalStore.receive.setTicket("");
      toast.success(t("receive.connecting"));
    } catch (e) {
      toast.error(`${t("common.confirm")}: ${e}`);
    } finally {
      globalStore.receive.setIsReceiving(false);
    }
  }

  async function handleCancel(transfer: Transfer) {
    try {
      if (transfer.status === "cancelled") {
        await delete_transfer(transfer.id);
      } else {
        await cancel_transfer(transfer.id);
      }
      await loadTransfers();
    } catch (e) {}
  }

  async function handleCancelById(id: string) {
    const transfer = transfers().find((t) => t.id === id);
    if (transfer) {
      await handleCancel(transfer);
    }
  }

  async function handleAcceptNearbyRequest() {
    const request = globalStore.nearbyReceive.state().incomingRequest;
    if (!request) return;

    try {
      await accept_incoming(request.id, receiveOutputDir() || undefined);
      globalStore.nearbyReceive.setTransferState("receiving");
      setTransferView("receive");
      setActiveTab("transfer");
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

  async function handleAcceptCloudTicket() {
    const ticket = globalStore.cloudReceive.state().currentTicket;
    if (!ticket) return;

    try {
      globalStore.cloudReceive.setTransferState("receiving");
      await accept_cloud_ticket(ticket.id, receiveOutputDir() || undefined);
      globalStore.cloudReceive.setCurrentTicket(null);
      globalStore.cloudReceive.setTransferState("idle");
      setTransferView("receive");
      setActiveTab("transfer");
      toast.success(t("nearby.transferComplete"));

      // Mark ticket as received on the server (best-effort)
      const ticketId = ticket.id;
      requestCloudApi(getCloudApiUrl(`/api/tickets/${ticketId}/receive`), {
        method: "POST",
      }).catch(() => {});
    } catch (e) {
      globalStore.cloudReceive.setError(String(e));
      globalStore.cloudReceive.setTransferState("idle");
      toast.error(`Failed to receive file: ${e}`);
    }
  }

  async function handleDeclineCloudTicket() {
    const ticket = globalStore.cloudReceive.state().currentTicket;
    if (!ticket) return;

    try {
      await decline_cloud_ticket(ticket.id);
      globalStore.cloudReceive.setCurrentTicket(null);
      globalStore.cloudReceive.setTransferState("idle");
      // Show next pending ticket if any
      const remaining = globalStore.cloudReceive
        .state()
        .tickets.filter((t) => t.id !== ticket.id);
      if (remaining.length > 0) {
        globalStore.cloudReceive.setCurrentTicket(remaining[0]);
        globalStore.cloudReceive.setTransferState("review");
      }
    } catch (e) {
      toast.error(`Failed to decline: ${e}`);
    }
  }

  async function handleClearTransfers() {
    try {
      await clear_transfers();
      setTransfers([]);
      toast.success(t("common.clear") + "!");
    } catch (e) {}
  }

  async function handleOpenFile(transfer: Transfer) {
    if (
      transfer.transfer_type === "receive" &&
      transfer.status.includes("complete")
    ) {
      try {
        await open_received_file(transfer.id);
      } catch (e) {}
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
    globalStore.send.setTicketQrCode(
      await QRCode.toDataURL(ticket, {
        errorCorrectionLevel: "H",
        width: 280,
      }),
    );
    setShowQrCode(!isMobile());
    globalStore.send.setShowReshareModal(true);
  }

  async function copyToClipboard(text: string) {
    try {
      try {
        await writeClipboardText(text);
      } catch (tauriErr) {
        console.warn("Tauri clipboard write failed, falling back:", tauriErr);
        await navigator.clipboard.writeText(text);
      }
      toast.success(t("common.copied"));
    } catch (error) {
      console.error("Clipboard write failed:", error);
      toast.error(String(error));
    }
  }

  async function handleScanBarcode() {
    try {
      let permissionStatus = await checkPermissions();
      if (permissionStatus !== "granted") {
        permissionStatus = await requestPermissions();
      }
      if (permissionStatus === "granted") {
        const result = await scan({ formats: [Format.QRCode] });
        if (result?.content) {
          globalStore.receive.setTicket(result.content);
        }
      } else {
        toast.error(t("receive.clipboardError"));
      }
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function pasteTicketFromClipboard() {
    try {
      let text: string;
      try {
        text = await readClipboardText();
      } catch (tauriErr) {
        console.warn("Tauri clipboard read failed, falling back:", tauriErr);
        text = await navigator.clipboard.readText();
      }
      text = text.trim();
      if (!text) {
        toast.error(t("receive.clipboardError"));
        return;
      }
      globalStore.receive.setTicket(text);
      toast.success(t("receive.readyToDownload"));
    } catch (error) {
      console.error("Clipboard read failed:", error);
      toast.error(t("receive.clipboardError"));
    }
  }

  async function handleNativeShare(text: string) {
    if (typeof navigator === "undefined" || !("share" in navigator)) return;

    try {
      await navigator.share?.({ text });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error(String(error));
    }
  }

  function renderFileTypeIcon(path: string) {
    const iconName = getFileIcon(getDisplayName(path));
    switch (iconName) {
      case "FileImage":
        return <FileImage size={18} />;
      case "FileArchive":
        return <FileArchive size={18} />;
      case "FileCode":
        return <FileCode size={18} />;
      default:
        return <FileText size={18} />;
    }
  }

  const transferSummary = createMemo(() => {
    const items = transfers();
    const completed = items.filter((transfer) =>
      transfer.status.toLowerCase().includes("complete"),
    ).length;
    const active = items.filter((transfer) => {
      const status = transfer.status.toLowerCase();
      return status.includes("serving") || status.includes("downloading");
    }).length;
    const sent = items.filter(
      (transfer) => transfer.transfer_type === "send",
    ).length;
    const received = items.filter(
      (transfer) => transfer.transfer_type === "receive",
    ).length;

    return {
      total: items.length,
      active,
      completed,
      sent,
      received,
    };
  });

  onMount(async () => {
    try {
      const p = platform();
      setIsMobile(p === "android" || p === "ios");
    } catch (e) {}

    const mq = window.matchMedia("(max-width: 640px)");
    setIsSmallWindow(mq.matches);
    mq.addEventListener("change", (e) => setIsSmallWindow(e.matches));

    const savedTheme = localStorage.getItem("theme") as Theme | null;
    setThemeValue(savedTheme || "system");

    const savedOutputDir = localStorage.getItem("receive-output-dir");
    if (savedOutputDir) globalStore.receive.setOutputDir(savedOutputDir);

    await loadTransfers();
    await start_nearby_discovery().catch(() => {});

    const unlisten = await listen<ProgressUpdate>("progress", (event) => {
      const { transfer_id, ...data } = event.payload.data;
      setProgressData((prev) => {
        const prevData = prev[transfer_id];
        let downloadPercent = prevData?.downloadPercent ?? 0;
        // Keep the max download percentage across download events
        if (data.progress?.type === "downloading" && data.progress.total > 0) {
          downloadPercent = Math.max(
            downloadPercent,
            (data.progress.offset / data.progress.total) * 100,
          );
        }
        return {
          ...prev,
          [transfer_id]: {
            transfer_id,
            event_type: event.payload.event_type,
            downloadPercent,
            ...data,
          },
        };
      });
      if (
        !currentReceivingId() &&
        data.progress?.type &&
        data.progress.type !== "completed"
      )
        setCurrentReceivingId(transfer_id);
      if (
        currentReceivingId() === transfer_id &&
        data.progress?.type === "completed"
      ) {
        setTimeout(() => {
          if (currentReceivingId() === transfer_id) setCurrentReceivingId(null);
        }, 2000);
      }
    });

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

    const unlistenCloudTickets = await listen<CloudTicket[]>(
      "cloud_tickets_updated",
      (event) => {
        const tickets = event.payload.filter(
          (t) => (t.status ?? "pending") === "pending",
        );
        globalStore.cloudReceive.setTickets(tickets);
        // Auto-show first pending ticket if idle
        if (
          tickets.length > 0 &&
          globalStore.cloudReceive.state().transferState === "idle"
        ) {
          globalStore.cloudReceive.setCurrentTicket(tickets[0]);
          globalStore.cloudReceive.setTransferState("review");
        }
      },
    );

    onCleanup(() => {
      unlisten();
      unlistenNearby();
      unlistenNearbyCancel();
      unlistenNearbyDecline();
      unlistenNearbyReceive();
      unlistenCloudTickets();
      stop_nearby_discovery().catch(() => {});
    });
    setIsInitializing(false);
  });

  createEffect(() => {
    const outputDir = receiveOutputDir();
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

      <main class="safe-area-top-offset mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 overflow-auto px-4 pb-28">
        <Presence exitBeforeEnter>
          <Switch>
            <Match when={activeTab() === "transfer"}>
              <Motion.div
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                class="space-y-6"
              >
                <div class="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
                  <section class="surface-card space-y-5 p-5 md:p-6">
                    <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div class="space-y-2">
                        <div class="flex items-center gap-2">
                          {renderTransferTitleIcon()}
                          <h1 class="text-xl font-semibold md:text-2xl">
                            {transferMode() === "send"
                              ? t("send.title")
                              : transferMode() === "receive"
                                ? t("receive.title")
                                : t("text.title")}
                          </h1>
                        </div>
                        <div>
                          <p class="text-base-content/65 mt-2 max-w-2xl text-sm leading-6">
                            {transferMode() === "send"
                              ? t("send.subtitle")
                              : transferMode() === "receive"
                                ? t("receive.subtitle")
                                : t("text.subtitle")}
                          </p>
                        </div>
                      </div>

                      <div class="join border-base-300/80 bg-base-100/60 flex gap-2 self-start rounded-2xl border p-1">
                        <button
                          class={`join-item btn rounded-2xl border-0 ${transferMode() === "send" ? "btn-primary" : "btn-ghost"}`}
                          onClick={() => setTransferView("send")}
                        >
                          {t("common.send")}
                        </button>
                        <button
                          class={`join-item btn rounded-2xl border-0 ${transferMode() === "receive" ? "btn-secondary" : "btn-ghost"}`}
                          onClick={() => setTransferView("receive")}
                        >
                          {t("common.receive")}
                        </button>
                        <button
                          class={`join-item btn rounded-2xl border-0 ${transferMode() === "text" ? "btn-accent" : "btn-ghost"}`}
                          onClick={() => setTransferView("text")}
                        >
                          {t("common.text")}
                        </button>
                      </div>
                    </div>

                    <Show
                      when={transferMode() !== "receive"}
                      fallback={
                        <div class="space-y-4">
                          <div class="border-base-300/70 bg-base-100/70 rounded-3xl border p-4">
                            <div class="mb-2 flex items-center justify-between gap-3">
                              <label class="text-sm font-medium">
                                {t("common.pasteTicket")}
                              </label>
                              <button
                                onClick={pasteTicketFromClipboard}
                                class="btn btn-ghost btn-xs"
                                title={t("receive.pasteFromClipboard")}
                              >
                                <Copy size={14} />
                                {t("common.paste")}
                              </button>
                            </div>
                            <label class="input input-bordered bg-base-100 flex w-full items-center gap-2 rounded-2xl">
                              <Shield size={18} class="opacity-40" />
                              <input
                                type="text"
                                value={receiveTicket()}
                                onInput={(e) =>
                                  globalStore.receive.setTicket(
                                    e.currentTarget.value,
                                  )
                                }
                                placeholder={t("common.pasteTicket")}
                                class="grow"
                              />
                              <Show when={isMobile()}>
                                <button
                                  onClick={handleScanBarcode}
                                  class="btn btn-ghost btn-sm btn-circle"
                                  title="Scan QR"
                                >
                                  <Scan size={18} />
                                </button>
                              </Show>
                            </label>
                          </div>

                          <div class="border-base-300/70 bg-base-100/70 rounded-3xl border p-4">
                            <div class="mb-2 flex items-center justify-between gap-3">
                              <div class="min-w-0 flex-1">
                                <p class="text-sm font-medium">
                                  {t("common.defaultDownloads")}
                                </p>
                                <p class="text-base-content/60 mt-1 truncate text-xs">
                                  {receiveOutputDir()
                                    ? getDisplayName(receiveOutputDir())
                                    : t("common.defaultDownloads")}
                                </p>
                              </div>
                              <button
                                onClick={selectOutputDirectory}
                                class="btn btn-outline btn-sm shrink-0 rounded-xl"
                              >
                                <RefreshCw size={14} />
                                {t("send.chooseFolder")}
                              </button>
                            </div>
                            <div class="border-base-300/70 bg-base-100 text-base-content/75 max-w-full min-w-0 overflow-hidden rounded-2xl border px-4 py-3 text-sm break-all">
                              {receiveOutputDir() ||
                                t("common.defaultDownloads")}
                            </div>
                          </div>

                          <button
                            onClick={handleReceive}
                            disabled={isReceiving() || !receiveTicket().trim()}
                            class={`btn btn-secondary btn-lg w-full rounded-2xl shadow-sm`}
                          >
                            <Download size={18} /> {t("receive.receiveFile")}
                          </button>

                          <Show when={currentReceivingId()}>
                            {(id) => (
                              <ProgressBorder
                                percent={() =>
                                  Math.round(receiveProgressPercent())
                                }
                              >
                                <div class="p-4">
                                  <div class="mb-3 flex items-start justify-between gap-3">
                                    <div>
                                      <p class="text-base-content/55 text-xs font-semibold tracking-[0.2em] uppercase">
                                        {t("common.receiving")}
                                      </p>
                                      <p class="text-secondary mt-1 text-2xl font-semibold">
                                        {Math.round(receiveProgressPercent())}%
                                      </p>
                                    </div>
                                    <div class="text-right text-sm opacity-70">
                                      {progressData()[id()]?.progress?.type ===
                                      "downloading" ? (
                                        <p>
                                          {formatFileSize(
                                            progressData()[id()]!.progress
                                              .offset,
                                          )}{" "}
                                          /{" "}
                                          {formatFileSize(
                                            progressData()[id()]!.progress
                                              .total,
                                          )}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleCancelById(id())}
                                    class="btn btn-ghost btn-sm text-error mt-2 w-full rounded-2xl"
                                  >
                                    <X size={14} class="mr-1" />{" "}
                                    {t("common.cancel")}
                                  </button>
                                </div>
                              </ProgressBorder>
                            )}
                          </Show>

                          <Show
                            when={
                              globalStore.nearbyReceive.state()
                                .transferState === "receiving" &&
                              globalStore.nearbyReceive.state().transferProgress
                            }
                          >
                            <TransferProgress
                              transferred={
                                globalStore.nearbyReceive.state()
                                  .transferProgress!.transferred
                              }
                              total={
                                globalStore.nearbyReceive.state()
                                  .transferProgress!.total
                              }
                              speed={
                                globalStore.nearbyReceive.state()
                                  .transferProgress!.speed
                              }
                              eta={
                                globalStore.nearbyReceive.state()
                                  .transferProgress!.eta
                              }
                              isReceiving={true}
                              onCancel={async () => {
                                globalStore.nearbyReceive.setIncomingRequest(
                                  null,
                                );
                                globalStore.nearbyReceive.setTransferState(
                                  "idle",
                                );
                              }}
                            />
                          </Show>
                        </div>
                      }
                    >
                      <div class="space-y-4">
                        <Show
                          when={isTextMode()}
                          fallback={
                            <div class="grid min-w-0 gap-3">
                              <DropZone
                                files={
                                  sendPath()
                                    ? [
                                        {
                                          name: getDisplayName(sendPath()),
                                          size: 0,
                                          path: sendPath(),
                                        },
                                      ]
                                    : []
                                }
                                onFilesSelected={(files) => {
                                  if (files.length > 0) {
                                    globalStore.send.setPath(files[0].path);
                                    globalStore.send.setTicket("");
                                    globalStore.send.setIsTextMode(false);
                                    globalStore.send.setIsFolder(false);
                                  }
                                }}
                                onRemoveFile={() => {
                                  globalStore.send.setPath("");
                                  globalStore.send.setTicket("");
                                }}
                              />
                            </div>
                          }
                        >
                          <textarea
                            value={textContent()}
                            onInput={(e) =>
                              globalStore.send.setTextContent(
                                e.currentTarget.value,
                              )
                            }
                            placeholder={t("text.placeholder")}
                            class="textarea textarea-bordered bg-base-100/75 min-h-48 w-full rounded-3xl p-4"
                          />
                        </Show>
                      </div>
                    </Show>
                  </section>

                  {/* Collapsible "Share via Ticket" for strangers / forums */}
                  <Show when={sendPath() || (isTextMode() && textContent()?.trim())}>
                    <div class="collapse collapse-arrow bg-base-200/50 rounded-2xl">
                      <input type="checkbox" />
                      <div class="collapse-title text-sm font-medium flex items-center gap-2 min-h-0 py-3">
                        <Link2 size={16} class="text-primary" />
                        {t("send.shareViaTicket")}
                      </div>
                      <div class="collapse-content space-y-3 pt-0">
                        <p class="text-base-content/60 text-xs">
                          {t("send.shareViaTicketHint")}
                        </p>

                        <div class="flex items-center gap-2">
                          <select
                            value={sendTicketType()}
                            onChange={(e) =>
                              globalStore.send.setTicketType(e.currentTarget.value)
                            }
                            class="select select-bordered select-sm flex-1 rounded-xl text-xs"
                          >
                            <For each={ticketTypes}>
                              {(tt) => (
                                <option value={tt.value}>{tt.label}</option>
                              )}
                            </For>
                          </select>
                          <button
                            onClick={handleGenerateTicket}
                            class="btn btn-primary btn-sm rounded-xl"
                            disabled={isSending()}
                          >
                            <Show
                              when={!isSending()}
                              fallback={
                                <span class="loading loading-spinner loading-xs"></span>
                              }
                            >
                              <Send size={14} />
                            </Show>
                            {t("send.generateTicket")}
                          </button>
                        </div>

                        <Show when={sendTicket()}>
                          <div class="space-y-3 mt-2">
                            <Show when={sendTicketQrCode()}>
                              <div class="flex justify-center">
                                <div class="rounded-xl bg-white p-2">
                                  <img
                                    src={sendTicketQrCode()}
                                    alt="QR"
                                    class="h-40 w-40"
                                  />
                                </div>
                              </div>
                            </Show>
                            <div class="bg-base-300 overflow-hidden rounded-lg p-2">
                              <code class="text-primary font-mono text-xs break-all">
                                {sendTicket()}
                              </code>
                            </div>
                            <div class="flex gap-2">
                              <button
                                onClick={() => copyToClipboard(sendTicket())}
                                class="btn btn-outline btn-sm flex-1 rounded-xl"
                              >
                                <Copy size={14} /> {t("common.copy")}
                              </button>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </Show>

                  <div class="space-y-4">
                    <Show
                      when={
                        globalStore.nearbyReceive.state().incomingRequest &&
                        globalStore.nearbyReceive.state().transferState ===
                          "review"
                      }
                    >
                      <div class="surface-card border-secondary/20 bg-secondary/10 p-5">
                        <div class="flex items-start justify-between gap-3">
                          <div>
                            <p class="text-secondary/80 text-xs font-semibold tracking-[0.2em] uppercase">
                              {t("nearby.transferRequest")}
                            </p>
                            <p class="text-base-content/75 mt-2 text-sm leading-6">
                              {t("nearby.requestModalHint")}
                            </p>
                          </div>
                          <button
                            onClick={() => setTransferView("receive")}
                            class="btn btn-secondary btn-sm rounded-xl"
                          >
                            {t("nearby.openReceive")}
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
                </div>

                <section class="surface-card space-y-4 p-4 md:p-5">
                  <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div class="flex items-center gap-2">
                        <Share2 size={18} class="text-primary" />
                        <h2 class="text-xl font-semibold">
                          {t("nearby.workspaceTitle")}
                        </h2>
                      </div>
                      <p class="text-base-content/65 mt-2 text-sm leading-6">
                        {t("nearby.workspaceSubtitle")}
                      </p>
                    </div>

                    <div class="tabs tabs-boxed bg-base-100/80 p-1">
                      <button
                        class={`tab gap-2 rounded-2xl ${shareSubTab() === "nearby" ? "tab-active" : ""}`}
                        onClick={() => setShareSubTab("nearby")}
                      >
                        <Radio size={16} />
                        {t("nearby.title")}
                      </button>
                      <button
                        class={`tab gap-2 rounded-2xl ${shareSubTab() === "devices" ? "tab-active" : ""}`}
                        onClick={() => setShareSubTab("devices")}
                      >
                        <Smartphone size={16} />
                        {t("devices.title")}
                      </button>
                      <button
                        class={`tab gap-2 rounded-2xl ${shareSubTab() === "friends" ? "tab-active" : ""}`}
                        onClick={() => setShareSubTab("friends")}
                      >
                        <User size={16} />
                        {t("friends.title")}
                      </button>
                    </div>
                  </div>

                  <Show when={shareSubTab() === "nearby"}>
                    <NearbyPage sendPath={sendPath() || undefined} isFolder={sendIsFolder()} />
                  </Show>
                  <Show when={shareSubTab() === "devices"}>
                    <DevicesPage
                      sendPath={sendPath() || undefined}
                      isTextMode={isTextMode()}
                      textContent={textContent()}
                    />
                  </Show>
                  <Show when={shareSubTab() === "friends"}>
                    <FriendsPage
                      sendPath={sendPath() || undefined}
                      isTextMode={isTextMode()}
                      textContent={textContent()}
                    />
                  </Show>
                </section>

                <section class="surface-card p-5">
                  <div class="mb-4 flex items-center gap-2">
                    <Shield size={18} class="text-primary" />
                    <h2 class="text-lg font-semibold">
                      {t("common.protocol")}
                    </h2>
                  </div>
                  <div class="space-y-3">
                    <div class="border-base-300/70 bg-base-100/70 rounded-2xl border p-4">
                      <p class="text-sm font-medium">
                        {t("landing.features.encryptedTitle")}
                      </p>
                      <p class="text-base-content/65 mt-1 text-xs leading-5">
                        {t("landing.features.encryptedDesc")}
                      </p>
                    </div>
                    <div class="border-base-300/70 bg-base-100/70 rounded-2xl border p-4">
                      <p class="text-sm font-medium">
                        {t("landing.features.fastTitle")}
                      </p>
                      <p class="text-base-content/65 mt-1 text-xs leading-5">
                        {t("landing.features.fastDesc")}
                      </p>
                    </div>
                  </div>
                </section>
              </Motion.div>
            </Match>

            <Match when={activeTab() === "history"}>
              <Motion.div
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                class="space-y-6"
              >
                <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p class="section-label">{t("common.activity")}</p>
                    <p class="text-base-content/65 mt-2 text-sm leading-6">
                      {t("history.emptyDesc")}
                    </p>
                  </div>
                  <div class="flex gap-2">
                    <button
                      onClick={handleClearTransfers}
                      class="btn btn-ghost btn-sm text-error rounded-xl"
                    >
                      {t("common.clear")}
                    </button>
                  </div>
                </div>

                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div class="surface-card p-4">
                    <p class="text-base-content/55 text-xs uppercase">
                      {t("history.sent")}
                    </p>
                    <p class="mt-2 text-2xl font-semibold">
                      {transferSummary().sent}
                    </p>
                  </div>
                  <div class="surface-card p-4">
                    <p class="text-base-content/55 text-xs uppercase">
                      {t("history.received")}
                    </p>
                    <p class="mt-2 text-2xl font-semibold">
                      {transferSummary().received}
                    </p>
                  </div>
                  <div class="surface-card p-4">
                    <p class="text-base-content/55 text-xs uppercase">
                      {t("common.online")}
                    </p>
                    <p class="mt-2 text-2xl font-semibold">
                      {transferSummary().active}
                    </p>
                  </div>
                  <div class="surface-card p-4">
                    <p class="text-base-content/55 text-xs uppercase">
                      {t("common.done")}
                    </p>
                    <p class="mt-2 text-2xl font-semibold">
                      {transferSummary().completed}
                    </p>
                  </div>
                </div>

                <Show
                  when={transfers().length > 0}
                  fallback={
                    <div class="surface-card flex flex-col items-center justify-center py-16 text-center opacity-70">
                      <History size={48} class="mb-3 opacity-30" />
                      <p class="text-sm font-medium">{t("history.empty")}</p>
                      <p class="text-base-content/60 mt-1 text-xs">
                        {t("history.emptyDesc")}
                      </p>
                    </div>
                  }
                >
                  <div class="space-y-3">
                    <For each={transfers()}>
                      {(transfer) => {
                        const status = getTransferStatus(transfer.status);
                        const isActiveReceive =
                          transfer.transfer_type === "receive" &&
                          status.label === "Downloading";
                        const receivePercent = () => {
                          const p = progressData()[transfer.id];
                          return p?.progress?.type === "completed"
                            ? 100
                            : p?.progress?.type === "downloading"
                              ? Math.round(
                                  Math.min(
                                    (p.progress.offset / p.progress.total) *
                                      100,
                                    99,
                                  ),
                                )
                              : p?.event_type === "export" ||
                                  [
                                    "file_progress",
                                    "file_started",
                                    "file_completed",
                                    "started",
                                  ].includes(p?.progress?.type)
                                ? 99
                                : 0;
                        };
                        return (() => {
                          const content = (
                            <>
                              <div class="flex flex-col gap-4 md:flex-row md:items-center">
                                <div
                                  class={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                                    transfer.transfer_type === "send"
                                      ? "bg-primary/12 text-primary"
                                      : "bg-secondary/12 text-secondary"
                                  }`}
                                >
                                  <Show
                                    when={transfer.transfer_type === "send"}
                                    fallback={renderFileTypeIcon(transfer.path)}
                                  >
                                    <Send size={18} />
                                  </Show>
                                </div>

                                <div class="min-w-0 flex-1">
                                  <button
                                    onClick={() => handleOpenFile(transfer)}
                                    class="hover:text-primary truncate text-left text-sm font-semibold"
                                  >
                                    {getDisplayName(transfer.path)}
                                  </button>
                                  <div class="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-70">
                                    <span
                                      class={`badge badge-sm border-0 ${
                                        transfer.transfer_type === "send"
                                          ? "bg-primary/12 text-primary"
                                          : "bg-secondary/12 text-secondary"
                                      }`}
                                    >
                                      {status.label}
                                    </span>
                                    <span>
                                      {formatDate(transfer.created_at)}
                                    </span>
                                  </div>
                                </div>

                                <div class="flex gap-2 md:self-start">
                                  <Show
                                    when={transfer.transfer_type === "send"}
                                  >
                                    <button
                                      onClick={() => handleReshare(transfer)}
                                      class="btn btn-ghost btn-sm text-primary rounded-xl"
                                      title={t("common.share")}
                                    >
                                      <SendIcon size={16} />
                                    </button>
                                  </Show>
                                  <button
                                    onClick={() => handleCancel(transfer)}
                                    class="btn btn-ghost btn-sm rounded-xl"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>

                              {isActiveReceive &&
                              progressData()[transfer.id] ? (
                                <div class="mt-4">
                                  <div class="mb-1 flex items-center justify-between text-xs">
                                    <span class="text-secondary font-medium">
                                      {receivePercent()}%
                                    </span>
                                    <span class="opacity-60">
                                      {formatFileSize(
                                        progressData()[transfer.id]?.progress
                                          ?.offset ?? 0,
                                      )}{" "}
                                      /{" "}
                                      {formatFileSize(
                                        progressData()[transfer.id]?.progress
                                          ?.total ?? 1,
                                      )}
                                    </span>
                                  </div>
                                  <progress
                                    class="progress progress-secondary w-full"
                                    value={
                                      progressData()[transfer.id]?.progress
                                        ?.offset ?? 0
                                    }
                                    max={
                                      progressData()[transfer.id]?.progress
                                        ?.total ?? 1
                                    }
                                  ></progress>
                                </div>
                              ) : null}
                            </>
                          );

                          if (isActiveReceive) {
                            return (
                              <ProgressBorder percent={receivePercent}>
                                <div class="surface-card relative p-4">
                                  {content}
                                </div>
                              </ProgressBorder>
                            );
                          }

                          return <div class="surface-card p-4">{content}</div>;
                        })();
                      }}
                    </For>
                  </div>
                </Show>
              </Motion.div>
            </Match>

            <Match when={activeTab() === "settings"}>
              <Motion.div
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                class="space-y-4"
              >
                <div>
                  <p class="section-label">{t("settings.title")}</p>
                </div>

                <Show
                  when={auth.isSignedIn()}
                  fallback={
                    <div class="surface-card p-5">
                      <div class="flex items-center gap-3">
                        <div class="avatar placeholder">
                          <div class="bg-primary text-primary-content flex w-12 items-center justify-center rounded-2xl">
                            <User size={20} />
                          </div>
                        </div>
                        <div class="flex-1">
                          <p class="font-semibold">{t("common.account")}</p>
                          <p class="text-xs opacity-60">
                            {t("common.signInToSync")}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => auth.signIn()}
                        class="btn btn-primary mt-4 rounded-2xl"
                      >
                        {t("common.signIn")}
                      </button>
                    </div>
                  }
                >
                  <div class="surface-card p-5">
                    <div class="flex items-center gap-3">
                      <Show when={auth.user()?.imageUrl}>
                        <img
                          src={auth.user()!.imageUrl}
                          class="h-12 w-12 rounded-2xl"
                          alt="avatar"
                        />
                      </Show>
                      <Show when={!auth.user()?.imageUrl}>
                        <div class="flex items-center gap-3">
                          <div class="avatar placeholder">
                            <div class="bg-primary text-primary-content flex w-12 items-center justify-center rounded-2xl">
                              <User size={20} />
                            </div>
                          </div>
                        </div>
                      </Show>
                      <div class="min-w-0 flex-1">
                        <p class="truncate font-semibold">
                          {auth.user()?.name || "User"}
                        </p>
                        <p class="truncate text-xs opacity-60">
                          {auth.user()?.email}
                        </p>
                      </div>
                      <button
                        onClick={() => auth.signOut()}
                        class="btn btn-ghost btn-sm rounded-xl"
                      >
                        <LogOut size={18} />
                      </button>
                    </div>
                  </div>
                </Show>

                <div class="grid gap-4 md:grid-cols-2">
                  <div class="surface-card p-5">
                    <div class="flex items-start justify-between gap-4">
                      <div>
                        <p class="font-semibold">{t("settings.language")}</p>
                        <p class="text-base-content/60 mt-2 text-sm">
                          {t("settings.languageDescription")}
                        </p>
                      </div>
                      <LanguageSwitcher />
                    </div>
                  </div>

                  <div class="surface-card p-5">
                    <div class="flex items-start justify-between gap-4">
                      <div>
                        <p class="font-semibold">{t("settings.theme")}</p>
                        <p class="text-base-content/60 mt-2 text-sm">
                          {t("settings.themeDescription")}
                        </p>
                      </div>
                      <ThemeSwitcher />
                    </div>
                  </div>

                  <div class="surface-card p-5">
                    <div class="flex items-center justify-between">
                      <span class="font-semibold">{t("common.online")}</span>
                      <span class="badge badge-success gap-1 rounded-full">
                        <span class="bg-success-content h-2 w-2 animate-pulse rounded-full"></span>
                        {t("common.p2pReady")}
                      </span>
                    </div>
                    <p class="text-base-content/60 mt-4 text-sm">
                      {t("landing.features.fastDesc")}
                    </p>
                  </div>

                  <div class="surface-card p-5">
                    <p class="font-semibold">{t("common.version")}</p>
                    <p class="text-base-content/60 mt-2 text-sm">
                      {t("common.appName")} v0.31.0
                    </p>
                    <p class="text-base-content/50 mt-1 text-xs">
                      {t("common.poweredBy")}
                    </p>
                  </div>
                </div>
              </Motion.div>
            </Match>
          </Switch>
        </Presence>
      </main>

      <Show when={globalStore.nearbyReceive.state().incomingRequest}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div class="card bg-base-100 w-full max-w-md shadow-2xl">
            <div class="card-body gap-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-base font-bold">
                    {t("nearby.transferRequest")}
                  </h3>
                  <p class="text-sm opacity-60">
                    {t("nearby.requestModalHint")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setTransferView("receive");
                    setActiveTab("transfer");
                  }}
                  class="btn btn-ghost btn-sm"
                >
                  {t("nearby.openReceive")}
                </button>
              </div>

              <IncomingRequestCard
                request={globalStore.nearbyReceive.state().incomingRequest!}
                onAccept={handleAcceptNearbyRequest}
                onDecline={handleDeclineNearbyRequest}
                disabled={
                  globalStore.nearbyReceive.state().transferState !== "review"
                }
                state={
                  globalStore.nearbyReceive.state().transferState ===
                  "receiving"
                    ? "accepting"
                    : "pending"
                }
              />
            </div>
          </div>
        </div>
      </Show>

      <Show when={globalStore.cloudReceive.state().currentTicket}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div class="card bg-base-100 w-full max-w-md shadow-2xl">
            <div class="card-body gap-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-base font-bold">
                    ☁️ {t("nearby.transferRequest")}
                  </h3>
                  <p class="text-sm opacity-60">
                    {globalStore.cloudReceive.state().currentTicket?.senderName || "Someone"}{" "}
                    wants to send you a file
                  </p>
                </div>
              </div>

              <IncomingRequestCard
                request={{
                  id: globalStore.cloudReceive.state().currentTicket!.id,
                  senderName:
                    globalStore.cloudReceive.state().currentTicket?.senderName || "Unknown",
                  files: [
                    {
                      name:
                        globalStore.cloudReceive.state().currentTicket?.filename || "file",
                      size:
                        globalStore.cloudReceive.state().currentTicket?.fileSize || 0,
                    },
                  ],
                  totalSize:
                    globalStore.cloudReceive.state().currentTicket?.fileSize || 0,
                }}
                onAccept={handleAcceptCloudTicket}
                onDecline={handleDeclineCloudTicket}
                disabled={
                  globalStore.cloudReceive.state().transferState !== "review"
                }
                state={
                  globalStore.cloudReceive.state().transferState === "receiving"
                    ? "accepting"
                    : "pending"
                }
              />
            </div>
          </div>
        </div>
      </Show>

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
              <Show
                when={globalStore.send.state().ticketQrCode && showQrCode()}
              >
                <div class="flex justify-center">
                  <div class="rounded-xl bg-white p-2">
                    <img
                      src={globalStore.send.state().ticketQrCode}
                      alt="QR"
                      class="h-48 w-48"
                    />
                  </div>
                </div>
              </Show>
              <Show when={isMobile() && globalStore.send.state().ticketQrCode}>
                <button
                  onClick={() => setShowQrCode((v) => !v)}
                  class="btn btn-ghost btn-sm w-full gap-1 rounded-xl text-xs"
                >
                  <ChevronDown
                    size={14}
                    class={`transition-transform ${showQrCode() ? "rotate-180" : ""}`}
                  />
                  {showQrCode() ? t("send.hideQrCode") : t("send.showQrCode")}
                </button>
              </Show>
              <div class="bg-base-300 overflow-hidden rounded-lg p-2">
                <code class="text-primary font-mono text-xs break-all">
                  {globalStore.send.state().ticket}
                </code>
              </div>
              <div class="flex gap-2">
                <button
                  onClick={() =>
                    copyToClipboard(globalStore.send.state().ticket)
                  }
                  class="btn btn-outline flex-1"
                >
                  <Copy size={14} /> {t("common.copy")}
                </button>
                <Show
                  when={
                    typeof navigator !== "undefined" && "share" in navigator
                  }
                >
                  <button
                    onClick={() =>
                      handleNativeShare(globalStore.send.state().ticket)
                    }
                    class="btn btn-outline flex-1"
                  >
                    <Share2 size={14} /> {t("common.share")}
                  </button>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

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
    </div>
  );
}

import {
  createSignal,
  onMount,
  onCleanup,
  For,
  Show,
  Switch,
  Match,
  createEffect,
} from "solid-js";
import {
  send_file,
  receive_file,
  send_text,
  cancel_transfer,
  delete_transfer,
  get_transfers,
  clear_transfers,
  open_received_file,
  pick_directory,
} from "~/bindings";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
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
  Loader2,
  FolderOpen,
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
  ChevronRight,
  Sun,
  Moon,
  History,
  Settings,
  Scan,
  Trash2,
  Sparkles,
  Shield,
  Zap,
  User,
  LogOut,
} from "lucide-solid";

import { Toaster, toast } from "solid-sonner";
import {
  formatFileSize,
  formatDate,
  getDisplayName,
  getFileIcon,
  getTransferStatus,
} from "~/lib/utils";
import { useAuth } from "~/lib/auth";
import { ThemeSwitcher } from "~/lib/ThemeSwitcher";
import { LanguageSwitcher } from "~/lib/LanguageSwitcher";
import { i18n } from "~/lib/i18n";
import { useGlobalStore } from "~/lib/store";

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
type Tab = "send" | "receive" | "history" | "settings";

const ticketTypes = [
  { value: "id", label: "ID Only" },
  { value: "relay", label: "Relay" },
  { value: "addresses", label: "Addresses" },
  { value: "relay_and_addresses", label: "Relay + Addresses" },
];

export default function MainPage() {
  const auth = useAuth();
  const globalStore = useGlobalStore();

  const [isMobile, setIsMobile] = createSignal(false);
  const [isSmallWindow, setIsSmallWindow] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [theme, setTheme] = createSignal<Theme>("system");
  const [activeTab, setActiveTab] = createSignal<Tab>("send");

  const sendPath = () => globalStore.send.state().path;
  const sendTicketType = () => globalStore.send.state().ticketType;
  const sendTicket = () => globalStore.send.state().ticket;
  const sendTicketQrCode = () => globalStore.send.state().ticketQrCode;
  const isSending = () => globalStore.send.state().isSending;
  const isTextMode = () => globalStore.send.state().isTextMode;
  const textContent = () => globalStore.send.state().textContent;

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

  const receiveProgressPercent = () => {
    if (!currentReceivingId()) return 0;
    const data = progressData()[currentReceivingId()!];
    if (!data?.progress) return 0;
    if (data.progress.type === "downloading")
      return (data.progress.offset / data.progress.total) * 100;
    if (data.progress.type === "completed") return 100;
    return 0;
  };

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

  async function selectFile() {
    try {
      const selected = await open({ multiple: false, directory: false });
      if (selected && typeof selected === "string") {
        globalStore.send.setPath(selected);
        globalStore.send.setTicket("");
        globalStore.send.setIsTextMode(false);
      }
    } catch (e) {}
  }

  async function selectDirectory() {
    try {
      const selected = await open({ multiple: false, directory: true });
      if (selected && typeof selected === "string") {
        globalStore.send.setPath(selected);
        globalStore.send.setTicket("");
        globalStore.send.setIsTextMode(false);
      }
    } catch (e) {}
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

  async function handleSend() {
    globalStore.send.setIsSending(true);
    try {
      const result = isTextMode()
        ? await send_text({
            text: textContent(),
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
    if (!receiveTicket()) return;
    globalStore.receive.setIsReceiving(true);
    try {
      await receive_file({
        ticket: receiveTicket(),
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
    console.log("Cancelling transfer", transfer);
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
    globalStore.send.setShowReshareModal(true);
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  }

  async function handleScanBarcode() {
    console.log("[DEBUG] handleScanBarcode called");
    try {
      console.log("[DEBUG] Checking permissions...");
      let permissionStatus = await checkPermissions();
      console.log("[DEBUG] checkPermissions result:", permissionStatus);
      if (permissionStatus !== "granted") {
        console.log("[DEBUG] Requesting permissions...");
        permissionStatus = await requestPermissions();
        console.log("[DEBUG] requestPermissions result:", permissionStatus);
      }
      if (permissionStatus === "granted") {
        console.log("[DEBUG] Permissions granted, starting scan...");
        const result = await scan({ formats: [Format.QRCode] });
        console.log("[DEBUG] scan result:", result);
        if (result?.content) {
          console.log("[DEBUG] Setting ticket:", result.content);
          globalStore.receive.setTicket(result.content);
        }
      } else {
        console.log("[DEBUG] Permissions not granted");
      }
    } catch (e) {
      console.error("[DEBUG] handleScanBarcode error:", e);
    }
  }

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

    const unlisten = await listen<ProgressUpdate>("progress", (event) => {
      const { transfer_id, ...data } = event.payload.data;
      setProgressData((prev) => ({
        ...prev,
        [transfer_id]: { transfer_id, ...data },
      }));
      if (!currentReceivingId() && data.progress?.type === "metadata")
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

    onCleanup(() => unlisten());
    setIsInitializing(false);
  });

  const LoadingUI = () => (
    <div class="bg-base-200 flex min-h-screen flex-col items-center justify-center">
      <span class="loading loading-spinner loading-lg text-primary"></span>
      <p class="text-base-content/60 mt-4 text-sm">{t("common.loading")}</p>
    </div>
  );

  return (
    <Show when={!isInitializing()} fallback={<LoadingUI />}>
      <div class="bg-base-100 text-base-content flex min-h-screen flex-col">
        <Toaster position="top-center" />

        <header class="navbar bg-base-100 px-4 py-2 shadow-sm">
          <div class="flex-1">
            <div class="flex items-center gap-3">
              <div class="avatar">
                <div class="bg-primary text-primary-content flex w-10 items-center justify-center rounded-full">
                  <Sparkles size={20} />
                </div>
              </div>
              <span class="text-lg font-bold">{t("common.appName")}</span>
            </div>
          </div>
          <div class="flex flex-none items-center gap-1">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </header>

        <main class="flex-1 overflow-auto p-4 pb-24">
          <Presence exitBeforeEnter>
            <Switch>
              <Match when={activeTab() === "send"}>
                <Motion.div
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  class="space-y-4"
                >
                  <div class="card bg-base-200">
                    <div class="card-body gap-4">
                      <div class="flex items-center justify-between">
                        <h2 class="card-title text-base-content/60 text-sm tracking-wider uppercase">
                          Send
                        </h2>
                        <div class="join">
                          <button
                            class={`join-item btn btn-sm ${!isTextMode() ? "btn-primary" : "btn-ghost"}`}
                            onClick={() =>
                              globalStore.send.setIsTextMode(false)
                            }
                          >
                            {t("common.files")}
                          </button>
                          <button
                            class={`join-item btn btn-sm ${isTextMode() ? "btn-primary" : "btn-ghost"}`}
                            onClick={() => globalStore.send.setIsTextMode(true)}
                          >
                            {t("common.text")}
                          </button>
                        </div>
                      </div>

                      <Show when={isTextMode()}>
                        <textarea
                          value={textContent()}
                          onInput={(e) =>
                            globalStore.send.setTextContent(
                              e.currentTarget.value,
                            )
                          }
                          placeholder={t("text.placeholder")}
                          class="textarea textarea-bordered w-full"
                          rows={4}
                        />
                      </Show>

                      <Show when={!isTextMode()}>
                        <div
                          onClick={selectFile}
                          class="border-base-300 bg-base-300/30 hover:border-primary hover:bg-primary/5 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 transition-colors"
                        >
                          <SendIcon size={32} class="mb-2 opacity-40" />
                          <span class="text-sm opacity-60">
                            {sendPath()
                              ? getDisplayName(sendPath())
                              : t("common.selectFileOrFolder")}
                          </span>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                          <button onClick={selectFile} class="btn btn-outline">
                            <FileText size={16} /> {t("common.files")}
                          </button>
                          <button
                            onClick={selectDirectory}
                            class="btn btn-outline"
                          >
                            <FolderOpen size={16} /> {t("send.chooseFolder")}
                          </button>
                        </div>
                      </Show>

                      <div class="form-control w-full">
                        <select
                          class="select select-bordered"
                          value={sendTicketType()}
                          onChange={(e) =>
                            globalStore.send.setTicketType(
                              e.currentTarget.value,
                            )
                          }
                        >
                          <For each={ticketTypes}>
                            {(t) => <option value={t.value}>{t.label}</option>}
                          </For>
                        </select>
                      </div>

                      <button
                        onClick={handleSend}
                        disabled={isSending() || (!isTextMode() && !sendPath())}
                        class={`btn btn-primary ${isSending() ? "loading" : ""}`}
                      >
                        <Show when={!isSending()}>
                          <Zap size={18} /> {t("common.share")}
                        </Show>
                      </button>

                      <Show when={sendTicket()}>
                        <div class="divider"></div>
                        <div class="flex flex-col items-center gap-4">
                          <Show when={sendTicketQrCode()}>
                            <div class="rounded-xl bg-white p-2">
                              <img
                                src={sendTicketQrCode()!}
                                alt="QR"
                                class="h-60 w-60"
                              />
                            </div>
                          </Show>
                          <div class="w-full">
                            <div class="bg-base-300 overflow-hidden rounded-lg p-2">
                              <code class="text-primary font-mono text-xs break-all">
                                g{sendTicket()}
                              </code>
                            </div>
                            <div class="mt-2 flex gap-2">
                              <button
                                onClick={() => copyToClipboard(sendTicket()!)}
                                class="btn btn-sm btn-outline flex-1"
                              >
                                <Copy size={14} /> {t("common.copy")}
                              </button>
                              <Show
                                when={
                                  typeof navigator !== "undefined" &&
                                  "share" in navigator
                                }
                              >
                                <button
                                  onClick={() =>
                                    navigator.share?.({ text: sendTicket()! })
                                  }
                                  class="btn btn-sm btn-outline flex-1"
                                >
                                  <Share2 size={14} /> {t("common.share")}
                                </button>
                              </Show>
                            </div>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </div>
                </Motion.div>
              </Match>

              <Match when={activeTab() === "receive"}>
                <Motion.div
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  class="space-y-4"
                >
                  <div class="card bg-base-200">
                    <div class="card-body gap-4">
                      <h2 class="card-title text-base-content/60 text-sm tracking-wider uppercase">
                        Receive
                      </h2>

                      <div class="form-control w-full">
                        <label class="input input-bordered flex w-full items-center gap-2">
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
                              onClick={() => {
                                console.log("[DEBUG] Scan button clicked");
                                handleScanBarcode();
                              }}
                              class="text-primary"
                            >
                              <Scan size={18} />
                            </button>
                          </Show>
                        </label>
                      </div>

                      <div class="form-control w-full">
                        <label class="input input-bordered flex w-full items-center gap-2">
                          <FolderOpen size={18} class="opacity-40" />
                          <input
                            type="text"
                            readonly
                            value={
                              receiveOutputDir() || t("common.defaultDownloads")
                            }
                            class="grow text-sm"
                          />
                          <button
                            onClick={selectOutputDirectory}
                            class="btn btn-ghost btn-sm"
                          >
                            <RefreshCw size={14} />
                          </button>
                        </label>
                      </div>

                      <button
                        onClick={handleReceive}
                        disabled={isReceiving() || !receiveTicket()}
                        class={`btn btn-secondary ${isReceiving() ? "loading" : ""}`}
                      >
                        <Show when={!isReceiving()}>
                          <Download size={18} /> {t("common.receive")}
                        </Show>
                      </button>

                      <Show when={currentReceivingId()}>
                        <div class="bg-secondary/10 border-secondary/20 rounded-lg border p-4">
                          <div class="mb-2 flex items-center justify-between">
                            <span class="text-xs font-bold uppercase opacity-60">
                              {t("common.receiving")}
                            </span>
                            <span class="font-mono text-sm font-bold">
                              {Math.round(receiveProgressPercent())}%
                            </span>
                          </div>
                          <progress
                            class="progress progress-secondary w-full"
                            value={receiveProgressPercent()}
                            max="100"
                          ></progress>
                          <button
                            onClick={() =>
                              handleCancelById(currentReceivingId()!)
                            }
                            class="btn btn-ghost btn-sm text-error mt-2"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </Show>
                    </div>
                  </div>
                </Motion.div>
              </Match>

              <Match when={activeTab() === "history"}>
                <Motion.div
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  class="space-y-4"
                >
                  <div class="flex items-center justify-between">
                    <h2 class="text-base-content/60 text-sm font-bold tracking-wider uppercase">
                      {t("common.activity")}
                    </h2>
                    <button
                      onClick={handleClearTransfers}
                      class="btn btn-ghost btn-sm text-error"
                    >
                      {t("common.clear")}
                    </button>
                  </div>

                  <Show
                    when={transfers().length > 0}
                    fallback={
                      <div class="flex flex-col items-center justify-center py-12 opacity-40">
                        <History size={48} class="mb-2" />
                        <p class="text-sm">{t("common.noHistoryYet")}</p>
                      </div>
                    }
                  >
                    <div class="space-y-2">
                      <For each={transfers()}>
                        {(transfer) => {
                          const s = getTransferStatus(transfer.status);
                          return (
                            <div class="card bg-base-200 p-3">
                              <div class="flex items-center gap-3">
                                <div
                                  class={`avatar ${transfer.transfer_type === "send" ? "placeholder" : "placeholder"}`}
                                >
                                  <div
                                    class={`flex w-10 items-center justify-center rounded-full ${transfer.transfer_type === "send" ? "bg-primary/20 text-primary" : "bg-secondary/20 text-secondary"}`}
                                  >
                                    <Show
                                      when={transfer.transfer_type === "send"}
                                      fallback={<Download size={18} />}
                                    >
                                      <Send size={18} />
                                    </Show>
                                  </div>
                                </div>
                                <div class="min-w-0 flex-1">
                                  <h4
                                    onClick={() => handleOpenFile(transfer)}
                                    class="hover:text-primary cursor-pointer truncate text-sm font-bold"
                                  >
                                    {getDisplayName(transfer.path)}
                                  </h4>
                                  <div class="flex items-center gap-2 text-xs opacity-60">
                                    <span class={`badge badge-sm ${s.color}`}>
                                      {s.label}
                                    </span>
                                    <span>
                                      {formatDate(transfer.created_at)}
                                    </span>
                                  </div>
                                </div>
                                <Show when={transfer.transfer_type === "send"}>
                                  <button
                                    onClick={() => handleReshare(transfer)}
                                    class="btn btn-ghost btn-sm text-primary"
                                    title={t("common.share")}
                                  >
                                    <SendIcon size={16} />
                                  </button>
                                </Show>
                                <button
                                  onClick={() => handleCancel(transfer)}
                                  class="btn btn-ghost btn-sm"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          );
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
                  <h2 class="text-base-content/60 text-sm font-bold tracking-wider uppercase">
                    Settings
                  </h2>

                  <Show
                    when={auth.isSignedIn()}
                    fallback={
                      <div class="card bg-base-200">
                        <div class="card-body">
                          <div class="flex items-center gap-3">
                            <div class="avatar placeholder">
                              <div class="bg-primary text-primary-content flex w-10 items-center justify-center rounded-full">
                                <User size={20} />
                              </div>
                            </div>
                            <div class="flex-1">
                              <p class="font-bold">{t("common.account")}</p>
                              <p class="text-xs opacity-60">
                                {t("common.signInToSync")}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => auth.signIn()}
                            class="btn btn-primary mt-2"
                          >
                            {t("common.signIn")}
                          </button>
                        </div>
                      </div>
                    }
                  >
                    <div class="card bg-base-200">
                      <div class="card-body">
                        <div class="flex items-center gap-3">
                          <Show when={auth.user()?.imageUrl}>
                            <img
                              src={auth.user()!.imageUrl}
                              class="h-10 w-10 rounded-full"
                              alt="avatar"
                            />
                          </Show>
                          <Show when={!auth.user()?.imageUrl}>
                            <div class="avatar placeholder">
                              <div class="bg-primary text-primary-content w-10 rounded-full">
                                <User size={20} />
                              </div>
                            </div>
                          </Show>
                          <div class="min-w-0 flex-1">
                            <p class="truncate font-bold">
                              {auth.user()?.name || "User"}
                            </p>
                            <p class="truncate text-xs opacity-60">
                              {auth.user()?.email}
                            </p>
                          </div>
                          <button
                            onClick={() => auth.signOut()}
                            class="btn btn-ghost btn-sm"
                          >
                            <LogOut size={18} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <div class="card bg-base-200">
                    <div class="card-body">
                      <div class="flex items-center justify-between">
                        <span class="font-bold">Status</span>
                        <span class="badge badge-success gap-1">
                          <span class="bg-success-content h-2 w-2 animate-pulse rounded-full"></span>
                          {t("common.online")}
                        </span>
                      </div>
                    </div>
                    <div class="card-body py-2">
                      <p class="text-xs opacity-40">
                        {t("common.appName")} v0.31.0
                      </p>
                    </div>
                  </div>
                </Motion.div>
              </Match>
            </Switch>
          </Presence>
        </main>

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
                <Show when={globalStore.send.state().ticketQrCode}>
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
                        navigator.share?.({
                          text: globalStore.send.state().ticket,
                        })
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

        <nav class="dock dock-md bg-base-200/80 border-base-300 border-t backdrop-blur-lg">
          <button
            class={`dock-label ${activeTab() === "send" ? "active" : ""}`}
            onClick={() => setActiveTab("send")}
          >
            <Send size={24} />
            <span>{t("common.send")}</span>
          </button>
          <button
            class={`dock-label ${activeTab() === "receive" ? "active" : ""}`}
            onClick={() => setActiveTab("receive")}
          >
            <Download size={24} />
            <span>{t("common.receive")}</span>
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
    </Show>
  );
}

import {
  createSignal,
  onMount,
  onCleanup,
  For,
  Show,
  Switch,
  Match,
} from "solid-js";
import {
  send_file,
  receive_file,
  send_text,
  cancel_transfer,
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
  FileCode,
  FileImage,
  FileArchive,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  Trash2,
  Sparkles,
  Shield,
  Zap,
  History,
  Settings,
  Scan,
} from "lucide-solid";

import { Toaster, toast } from "solid-sonner";
import {
  formatFileSize,
  formatDate,
  getDisplayName,
  getFileIcon,
  getTransferStatus,
  getProgressValue,
} from "~/lib/utils";
import { useAuth } from "~/lib/auth";
import { User, LogOut } from "lucide-solid";

// Types
interface Transfer {
  id: string;
  transfer_type: string;
  path: string;
  status: string;
  created_at: number;
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

// Ticket types
const ticketTypes = [
  {
    value: "id",
    label: "ID Only",
    description: "Smallest ticket, requires DNS",
  },
  { value: "relay", label: "Relay", description: "Uses relay server" },
  { value: "addresses", label: "Addresses", description: "Direct addresses" },
  {
    value: "relay_and_addresses",
    label: "Relay + Addresses",
    description: "Both relay and direct addresses",
  },
];

export default function MainPage() {
  // Auth
  const auth = useAuth();

  // Platform & UI state
  const [isMobile, setIsMobile] = createSignal(false);
  const [isSmallWindow, setIsSmallWindow] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [theme, setTheme] = createSignal<Theme>("system");
  const [activeTab, setActiveTab] = createSignal<
    "send" | "receive" | "history" | "settings"
  >("send");

  // Send state
  const [sendPath, setSendPath] = createSignal("");
  const [sendTicketType, setSendTicketType] = createSignal(
    "relay_and_addresses",
  );
  const [sendTicket, setSendTicket] = createSignal("");
  const [sendTicketQrCode, setSendTicketQrCode] = createSignal("");
  const [isSending, setIsSending] = createSignal(false);
  const [showTicketTypeMenu, setShowTicketTypeMenu] = createSignal(false);
  const [isTextMode, setIsTextMode] = createSignal(false);
  const [textContent, setTextContent] = createSignal("");

  // Receive state
  const [receiveTicket, setReceiveTicket] = createSignal("");
  const [receiveOutputDir, setReceiveOutputDir] = createSignal("");
  const [isReceiving, setIsReceiving] = createSignal(false);
  const [currentReceivingId, setCurrentReceivingId] = createSignal<
    string | null
  >(null);

  // Data state
  const [transfers, setTransfers] = createSignal<Transfer[]>([]);
  const [progressData, setProgressData] = createSignal<
    Record<string, ProgressData>
  >({});
  const [metadataCache, setMetadataCache] = createSignal<Record<string, any>>(
    {},
  );
  const [mousePos, setMousePos] = createSignal({ x: 0, y: 0 });

  // Computed
  const receiveProgressPercent = () => {
    if (!currentReceivingId()) return 0;
    const data = progressData()[currentReceivingId()!];
    if (!data?.progress) return 0;
    if (data.progress.type === "downloading")
      return (data.progress.offset / data.progress.total) * 100;
    if (data.progress.type === "completed") return 100;
    return 0;
  };

  // Theme logic
  function applyTheme(newTheme: Theme) {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    if (newTheme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
    } else {
      root.classList.add(newTheme);
    }
  }

  function setThemeValue(newTheme: Theme) {
    applyTheme(newTheme);
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  }

  // Action handlers
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
        setSendPath(selected);
        setSendTicket("");
        setIsTextMode(false);
      }
    } catch (e) {}
  }

  async function selectDirectory() {
    try {
      const selected = await open({ multiple: false, directory: true });
      if (selected && typeof selected === "string") {
        setSendPath(selected);
        setSendTicket("");
        setIsTextMode(false);
      }
    } catch (e) {}
  }

  async function selectOutputDirectory() {
    try {
      if (isMobile()) {
        const result = await pick_directory();
        setReceiveOutputDir(result.uri);
      } else {
        const selected = await open({ multiple: false, directory: true });
        if (selected && typeof selected === "string")
          setReceiveOutputDir(selected);
      }
    } catch (e) {}
  }

  async function handleSend() {
    setIsSending(true);
    try {
      const result = isTextMode()
        ? await send_text({
            text: textContent(),
            ticket_type: sendTicketType(),
          })
        : await send_file({ path: sendPath(), ticket_type: sendTicketType() });
      setSendTicket(result);
      setSendTicketQrCode(
        await QRCode.toDataURL(result, {
          errorCorrectionLevel: "H",
          width: 300,
        }),
      );
      await loadTransfers();
    } catch (e) {
      toast.error(`Send failed: ${e}`);
    } finally {
      setIsSending(false);
    }
  }

  async function handleReceive() {
    if (!receiveTicket()) return;
    setIsReceiving(true);
    try {
      await receive_file({
        ticket: receiveTicket(),
        output_dir: receiveOutputDir() || undefined,
      });
      await loadTransfers();
      setReceiveTicket("");
      toast.success("Connecting...");
    } catch (e) {
      toast.error(`Error: ${e}`);
    } finally {
      setIsReceiving(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      await cancel_transfer(id);
      await loadTransfers();
    } catch (e) {}
  }

  async function handleClearTransfers() {
    try {
      await clear_transfers();
      setTransfers([]);
      toast.success("History cleared");
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

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  }

  async function handleScanBarcode() {
    try {
      let permissionStatus = await checkPermissions();
      if (permissionStatus !== "granted")
        permissionStatus = await requestPermissions();
      if (permissionStatus === "granted") {
        const result = await scan({ formats: [Format.QRCode] });
        if (result?.content) setReceiveTicket(result.content);
      }
    } catch (e) {}
  }

  // Lifecycle
  onMount(async () => {
    try {
      const p = platform();
      setIsMobile(p === "android" || p === "ios");
    } catch (e) {}
    console.log("Platform:", platform());

    const mq = window.matchMedia("(max-width: 640px)");
    setIsSmallWindow(mq.matches);
    mq.addEventListener("change", (e) => setIsSmallWindow(e.matches));

    const savedTheme = localStorage.getItem("theme") as Theme | null;
    setThemeValue(savedTheme || "system");

    const savedOutputDir = localStorage.getItem("receive-output-dir");
    if (savedOutputDir) setReceiveOutputDir(savedOutputDir);

    console.log("Loading transfers...");

    await loadTransfers();

    console.log("Setting up event listeners...");

    window.addEventListener("mousemove", (e) =>
      setMousePos({ x: e.clientX, y: e.clientY }),
    );

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
      if (data.progress?.type === "metadata")
        setMetadataCache((prev) => ({ ...prev, [transfer_id]: data.progress }));
    });

    onCleanup(() => {
      unlisten();
    });

    setIsInitializing(false);
  });

  // UI Components
  const LoadingUI = () => (
    <div class="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-[#0c0a1a]">
      <Loader2 class="animate-spin text-purple-500" size={32} />
      <p class="mt-4 text-xs font-bold tracking-widest text-gray-400 uppercase">
        Sendme
      </p>
    </div>
  );

  const StatusIcon = (props: { status: any }) => (
    <div class={props.status.pulse ? "animate-pulse" : ""}>
      <Switch>
        <Match when={props.status.icon === "Check"}>
          <FileText size={12} />
        </Match>
        <Match when={props.status.icon === "Download"}>
          <Download size={12} />
        </Match>
        <Match when={true}>
          <RefreshCw size={12} class="animate-spin" />
        </Match>
      </Switch>
    </div>
  );

  return (
    <Show when={!isInitializing()} fallback={<LoadingUI />}>
      <div class="relative min-h-screen bg-gray-50 text-gray-900 transition-colors duration-300 dark:bg-[#0c0a1a] dark:text-white">
        <Toaster position="top-center" />

        {/* Dynamic Background */}
        {!isSmallWindow() && (
          <div class="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-30">
            <Motion.div
              animate={{ x: mousePos().x * 0.02, y: mousePos().y * 0.02 }}
              class="absolute top-[-10%] left-[-10%] h-[50%] w-[50%] rounded-full bg-purple-600/20 blur-[100px]"
            />
            <Motion.div
              animate={{ x: mousePos().x * -0.01, y: mousePos().y * -0.01 }}
              class="absolute right-[-10%] bottom-[-10%] h-[60%] w-[60%] rounded-full bg-indigo-600/20 blur-[100px]"
            />
          </div>
        )}

        <div class="relative z-10 flex flex-col sm:mx-auto sm:max-w-md sm:pt-4">
          {/* Header */}
          <header class="safe-area-top flex items-center justify-between px-4 py-3 sm:px-2">
            <div class="flex items-center gap-3">
              <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-purple-500 to-indigo-600 shadow-lg shadow-purple-500/20">
                <Sparkles size={18} class="text-white" />
              </div>
              <h1 class="text-lg font-bold tracking-tight">Sendme</h1>
            </div>
            <button
              onClick={() =>
                setThemeValue(theme() === "dark" ? "light" : "dark")
              }
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-200/50 dark:bg-white/5"
            >
              {theme() === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </header>

          {/* Content */}
          <main class="flex-1 p-4 pb-24 sm:p-2 sm:pb-8">
            <Presence exitBeforeEnter>
              <Switch>
                {/* SEND TAB */}
                <Match when={activeTab() === "send"}>
                  <Motion.div
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.15, easing: "ease-out" }}
                    class="space-y-4"
                  >
                    <div class="glass-liquid rounded-3xl border border-gray-200 p-4 dark:border-white/10">
                      <div class="mb-4 flex items-center justify-between">
                        <h2 class="text-sm font-bold tracking-wider uppercase opacity-60">
                          Send
                        </h2>
                        <div class="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5">
                          <button
                            onClick={() => setIsTextMode(false)}
                            class={`rounded-md px-3 py-1 text-[10px] font-bold ${!isTextMode() ? "bg-white text-purple-600 shadow-sm dark:bg-white/10 dark:text-purple-400" : "opacity-40"}`}
                          >
                            FILES
                          </button>
                          <button
                            onClick={() => setIsTextMode(true)}
                            class={`rounded-md px-3 py-1 text-[10px] font-bold ${isTextMode() ? "bg-white text-purple-600 shadow-sm dark:bg-white/10 dark:text-purple-400" : "opacity-40"}`}
                          >
                            TEXT
                          </button>
                        </div>
                      </div>

                      <Switch>
                        <Match when={isTextMode()}>
                          <textarea
                            value={textContent()}
                            onInput={(e) =>
                              setTextContent(e.currentTarget.value)
                            }
                            placeholder="Type message..."
                            class="h-28 w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm focus:outline-none dark:border-white/5 dark:bg-white/5"
                          />
                        </Match>
                        <Match when={!isTextMode()}>
                          <div
                            onClick={selectFile}
                            class="group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 py-8 transition-all duration-500 group-hover:bg-purple-500/20 group-hover:text-purple-400 dark:border-white/10 dark:bg-white/2"
                          >
                            <SendIcon size={32} class="mb-2 opacity-20" />
                            <span class="px-4 text-center text-xs font-medium opacity-60">
                              {sendPath()
                                ? getDisplayName(sendPath())
                                : "Select file or folder"}
                            </span>
                          </div>
                          <div class="mt-2 grid grid-cols-2 gap-2">
                            <button
                              onClick={selectFile}
                              class="flex h-10 items-center justify-center gap-2 rounded-xl bg-white text-xs font-bold dark:bg-white/5"
                            >
                              File
                            </button>
                            <button
                              onClick={selectDirectory}
                              class="flex h-10 items-center justify-center gap-2 rounded-xl bg-white text-xs font-bold dark:bg-white/5"
                            >
                              Folder
                            </button>
                          </div>
                        </Match>
                      </Switch>

                      <div class="mt-4 space-y-3">
                        <div class="relative">
                          <button
                            onClick={() =>
                              setShowTicketTypeMenu(!showTicketTypeMenu())
                            }
                            class="flex h-10 w-full items-center justify-between rounded-xl bg-gray-100 px-4 text-xs font-bold dark:bg-white/5"
                          >
                            <span class="opacity-60">
                              {
                                ticketTypes.find(
                                  (t) => t.value === sendTicketType(),
                                )?.label
                              }
                            </span>
                            <ChevronRight
                              size={14}
                              class={`transition-transform ${showTicketTypeMenu() ? "rotate-90" : ""}`}
                            />
                          </button>
                          <Show when={showTicketTypeMenu()}>
                            <div class="glass absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 dark:border-white/10">
                              {ticketTypes.map((t) => (
                                <button
                                  onClick={() => {
                                    setSendTicketType(t.value as any);
                                    setShowTicketTypeMenu(false);
                                  }}
                                  class="w-full p-3 text-left hover:bg-purple-500/10"
                                >
                                  <div class="text-[10px] font-bold">
                                    {t.label}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </Show>
                        </div>

                        <button
                          onClick={handleSend}
                          disabled={
                            isSending() || (!isTextMode() && !sendPath())
                          }
                          class="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-linear-to-r from-purple-600 to-indigo-600 font-bold text-white shadow-lg disabled:opacity-30"
                        >
                          {isSending() ? (
                            <Loader2 size={18} class="animate-spin" />
                          ) : (
                            <>
                              <Zap size={18} /> Share
                            </>
                          )}
                        </button>
                      </div>

                      <Show when={sendTicket()}>
                        <div class="mt-4 border-t border-gray-100 pt-4 dark:border-white/5">
                          <div class="flex items-center gap-4">
                            <Show when={sendTicketQrCode()}>
                              <div class="shrink-0 rounded-xl bg-white p-2">
                                <img
                                  src={sendTicketQrCode()!}
                                  alt="QR"
                                  class="h-20 w-20"
                                />
                              </div>
                            </Show>
                            <div class="min-w-0 flex-1 space-y-2">
                              <div class="glass-inset rounded-xl p-2 px-3">
                                <code class="block truncate font-mono text-[10px] text-purple-500">
                                  {sendTicket()}
                                </code>
                              </div>
                              <div class="flex gap-2">
                                <button
                                  onClick={() => copyToClipboard(sendTicket()!)}
                                  class="flex-1 rounded-lg bg-gray-100 py-1.5 text-[10px] font-bold dark:bg-white/5"
                                >
                                  Copy
                                </button>
                                <button
                                  onClick={() => {
                                    if (navigator.share)
                                      navigator.share({ text: sendTicket()! });
                                  }}
                                  class="flex-1 rounded-lg bg-gray-100 py-1.5 text-[10px] font-bold dark:bg-white/5"
                                >
                                  Share
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Motion.div>
                </Match>

                {/* RECEIVE TAB */}
                <Match when={activeTab() === "receive"}>
                  <Motion.div
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.15, easing: "ease-out" }}
                    class="space-y-4"
                  >
                    <div class="glass-liquid rounded-3xl border border-gray-200 p-4 dark:border-white/10">
                      <h2 class="mb-4 text-sm font-bold tracking-wider uppercase opacity-60">
                        Receive
                      </h2>
                      <div class="space-y-4">
                        <div class="relative">
                          <input
                            value={receiveTicket()}
                            onInput={(e) =>
                              setReceiveTicket(e.currentTarget.value)
                            }
                            placeholder="Paste ticket..."
                            class="h-12 w-full rounded-2xl border border-gray-200 bg-gray-50 pr-4 pl-10 text-sm focus:outline-none dark:border-white/5 dark:bg-white/5"
                          />
                          <Shield
                            size={18}
                            class="absolute top-1/2 left-4 -translate-y-1/2 opacity-20"
                          />
                          <Show when={isMobile()}>
                            <button
                              onClick={handleScanBarcode}
                              class="absolute top-1/2 right-4 -translate-y-1/2 text-purple-500"
                            >
                              <Scan size={18} />
                            </button>
                          </Show>
                        </div>

                        <div class="flex items-center gap-2">
                          <div class="relative flex-1">
                            <input
                              readOnly
                              value={receiveOutputDir() || "Default Downloads"}
                              class="h-10 w-full rounded-xl bg-gray-100 pr-4 pl-9 text-[10px] font-bold opacity-60 dark:bg-white/5"
                            />
                            <FolderOpen
                              size={14}
                              class="absolute top-1/2 left-3 -translate-y-1/2 opacity-20"
                            />
                          </div>
                          <button
                            onClick={selectOutputDirectory}
                            class="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/5"
                          >
                            <RefreshCw size={14} class="opacity-40" />
                          </button>
                        </div>

                        <button
                          onClick={handleReceive}
                          disabled={isReceiving() || !receiveTicket()}
                          class="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-linear-to-r from-indigo-600 to-purple-600 font-bold text-white shadow-lg disabled:opacity-30"
                        >
                          {isReceiving() ? (
                            <Loader2 size={18} class="animate-spin" />
                          ) : (
                            <>
                              <Download size={18} /> Receive
                            </>
                          )}
                        </button>
                      </div>

                      <Show when={currentReceivingId()}>
                        <div class="mt-4 rounded-2xl border border-indigo-500/10 bg-indigo-500/5 p-4">
                          <div class="mb-2 flex items-center justify-between">
                            <span class="text-[10px] font-bold uppercase opacity-60">
                              Receiving
                            </span>
                            <span class="font-mono text-xs font-bold">
                              {Math.round(receiveProgressPercent())}%
                            </span>
                          </div>
                          <div class="h-1.5 overflow-hidden rounded-full bg-indigo-500/10">
                            <div
                              class="h-full bg-indigo-500 transition-all"
                              style={{ width: `${receiveProgressPercent()}%` }}
                            />
                          </div>
                          <button
                            onClick={() => handleCancel(currentReceivingId()!)}
                            class="mt-3 text-[10px] font-bold text-red-500 opacity-60"
                          >
                            CANCEL
                          </button>
                        </div>
                      </Show>
                    </div>
                  </Motion.div>
                </Match>

                {/* HISTORY TAB */}
                <Match when={activeTab() === "history"}>
                  <Motion.div
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, easing: "ease-out" }}
                    class="space-y-4"
                  >
                    <div class="flex items-center justify-between px-1">
                      <h2 class="text-sm font-bold tracking-wider uppercase opacity-60">
                        Activity
                      </h2>
                      <button
                        onClick={handleClearTransfers}
                        class="text-[10px] font-bold text-red-400 opacity-60"
                      >
                        CLEAR
                      </button>
                    </div>

                    <Show
                      when={transfers().length > 0}
                      fallback={
                        <div class="py-12 text-center opacity-20">
                          <History size={40} class="mx-auto mb-2" />
                          <p class="text-xs font-bold">No history</p>
                        </div>
                      }
                    >
                      <div class="grid grid-cols-1 gap-2">
                        <For each={transfers()}>
                          {(t) => {
                            const s = getTransferStatus(t.status);
                            const Icon = getTransferFileIcon(t);
                            return (
                              <div class="flex items-center gap-3 rounded-2xl bg-white p-3 dark:bg-white/5">
                                <div
                                  class={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.transfer_type === "send" ? "bg-purple-500/10 text-purple-500" : "bg-indigo-500/10 text-indigo-500"}`}
                                >
                                  <Icon size={18} />
                                </div>
                                <div class="min-w-0 flex-1">
                                  <h4
                                    onClick={() => handleOpenFile(t)}
                                    class="truncate text-xs font-bold"
                                  >
                                    {getTransferDisplayName(t)}
                                  </h4>
                                  <div class="mt-0.5 flex items-center gap-2">
                                    <span
                                      class={`text-[9px] font-bold ${s.color}`}
                                    >
                                      {s.label}
                                    </span>
                                    <span class="text-[9px] opacity-20">•</span>
                                    <span class="text-[9px] opacity-20">
                                      {formatDate(t.created_at)}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleCancel(t.id)}
                                  class="text-gray-300 transition-colors hover:text-red-500 dark:text-white/10"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </Motion.div>
                </Match>

                {/* SETTINGS TAB */}
                <Match when={activeTab() === "settings"}>
                  <Motion.div
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, easing: "ease-out" }}
                    class="space-y-4"
                  >
                    <h2 class="px-1 text-sm font-bold tracking-wider uppercase opacity-60">
                      Settings
                    </h2>

                    {/* Account Section */}
                    <div class="divide-y overflow-hidden rounded-3xl border border-gray-200 bg-white dark:divide-white/5 dark:border-white/10 dark:bg-white/2">
                      <Show
                        when={auth.isSignedIn()}
                        fallback={
                          <div class="space-y-3 p-4">
                            <div class="flex items-center gap-3">
                              <User size={20} class="text-purple-500" />
                              <span class="text-sm font-bold">Account</span>
                            </div>
                            <button
                              onClick={() => auth.signIn()}
                              class="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white"
                            >
                              Sign In
                            </button>
                          </div>
                        }
                      >
                        <div class="space-y-3 p-4">
                          <div class="flex items-center gap-3">
                            <Show when={auth.user()?.imageUrl}>
                              <img
                                src={auth.user()!.imageUrl}
                                class="h-10 w-10 rounded-full"
                                alt="avatar"
                              />
                            </Show>
                            <Show when={!auth.user()?.imageUrl}>
                              <div class="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500">
                                <User size={20} class="text-white" />
                              </div>
                            </Show>
                            <div class="min-w-0 flex-1">
                              <p class="truncate text-sm font-bold">
                                {auth.user()?.name || "User"}
                              </p>
                              <p class="truncate text-xs opacity-60">
                                {auth.user()?.email}
                              </p>
                            </div>
                            <button
                              onClick={() => auth.signOut()}
                              class="p-2 opacity-60 hover:opacity-100"
                            >
                              <LogOut size={18} />
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>

                    <div class="divide-y overflow-hidden rounded-3xl border border-gray-200 bg-white dark:divide-white/5 dark:border-white/10 dark:bg-white/2">
                      <div class="flex items-center justify-between p-4">
                        <span class="text-xs font-bold">Theme</span>
                        <button
                          onClick={() =>
                            setThemeValue(theme() === "dark" ? "light" : "dark")
                          }
                          class="text-[10px] font-bold text-purple-500 uppercase"
                        >
                          {theme()}
                        </button>
                      </div>
                      <div class="flex items-center justify-between p-4">
                        <span class="text-xs font-bold">Node Status</span>
                        <span class="text-[9px] font-bold text-green-500">
                          ONLINE
                        </span>
                      </div>
                      <div class="p-4">
                        <p class="text-[10px] font-bold opacity-40">
                          Sendme v0.1.0 • P2P Protocol
                        </p>
                      </div>
                    </div>
                  </Motion.div>
                </Match>
              </Switch>
            </Presence>
          </main>

          {/* Navigation */}
          <nav class="safe-area-bottom fixed right-0 bottom-0 left-0 z-50 border-t border-gray-200 bg-white/80 backdrop-blur-xl dark:border-white/5 dark:bg-black/40">
            <div class="flex h-16 items-center justify-around px-2 sm:mx-auto sm:max-w-md">
              {[
                { id: "send", icon: Send, label: "SEND" },
                { id: "receive", icon: Download, label: "RECEIVE" },
                { id: "history", icon: History, label: "HISTORY" },
                { id: "settings", icon: Settings, label: "SETTINGS" },
              ].map((tab) => (
                <button
                  onClick={() => setActiveTab(tab.id as any)}
                  class={`flex flex-col items-center gap-1 p-2 transition-all ${activeTab() === tab.id ? "text-purple-600 dark:text-purple-400" : "opacity-30"}`}
                >
                  <tab.icon size={20} />
                  <span class="text-[8px] font-bold">{tab.label}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </Show>
  );
}

// Helpers for the new structure (minimal)
function getTransferDisplayName(transfer: any): string {
  return getDisplayName(transfer.path);
}

function getTransferFileIcon(transfer: any) {
  const iconName = getFileIcon(transfer.path);
  switch (iconName) {
    case "FileImage":
      return FileImage;
    case "FileArchive":
      return FileArchive;
    case "FileCode":
      return FileCode;
    default:
      return FileText;
  }
}

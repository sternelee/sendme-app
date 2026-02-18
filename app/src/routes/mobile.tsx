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
  cancel_transfer,
  get_transfers,
  open_received_file,
  pick_directory,
} from "~/bindings";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { platform } from "@tauri-apps/plugin-os";
import {
  scan,
  checkPermissions,
  requestPermissions,
} from "@tauri-apps/plugin-barcode-scanner";
import QRCode from "qrcode";
import { Motion, Presence } from "solid-motionone";
import {
  Loader2,
  FolderOpen,
  Copy,
  Check,
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
  Trash2,
  Scan,
  Sparkles,
  Zap,
  Home,
  History,
  Settings,
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
type MobileTab = "home" | "history" | "settings";

// Mobile-specific file picker
async function pick_directory_mobile(): Promise<string | null> {
  try {
    const currentPlatform = await platform();
    if (currentPlatform === "android" || currentPlatform === "ios") {
      const result = await pick_directory();
      return result?.uri || null;
    } else {
      const selected = await open({ directory: true });
      return selected as string | null;
    }
  } catch (e) {
    console.error("pick_directory error:", e);
    return null;
  }
}

export default function Mobile() {
  // State
  const [activeTab, setActiveTab] = createSignal<MobileTab>("home");
  const [isMobile, setIsMobile] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [theme, setTheme] = createSignal<Theme>("system");

  // Send state
  const [sendPath, setSendPath] = createSignal("");
  const [sendTicket, setSendTicket] = createSignal<string | null>(null);
  const [isSending, setIsSending] = createSignal(false);

  // Receive state
  const [receiveTicket, setReceiveTicket] = createSignal("");
  const [receiveOutputDir, setReceiveOutputDir] = createSignal("");
  const [isReceiving, setIsReceiving] = createSignal(false);
  const [receiveProgress, setReceiveProgress] = createSignal(0);

  // Transfer state
  const [transfers, setTransfers] = createSignal<Transfer[]>([]);
  const [currentSendingId, setCurrentSendingId] = createSignal<string | null>(null);
  const [currentReceivingId, setCurrentReceivingId] = createSignal<string | null>(null);

  // Theme functions
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
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        applyTheme(newTheme);
        setTheme(newTheme);
        localStorage.setItem("theme", newTheme);
      });
    } else {
      applyTheme(newTheme);
      setTheme(newTheme);
      localStorage.setItem("theme", newTheme);
    }
  }

  function toggleTheme() {
    const themes: Theme[] = ["light", "dark", "system"];
    const currentIndex = themes.indexOf(theme());
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setThemeValue(nextTheme);
  }

  // Load transfers
  async function loadTransfers() {
    try {
      const loaded = await get_transfers();
      setTransfers(loaded.sort((a, b) => b.created_at - a.created_at));
    } catch (e) {
      console.error("Failed to load transfers:", e);
    }
  }

  // File picker
  async function selectFile() {
    try {
      const selected = await open({ multiple: false, directory: false });
      if (selected && typeof selected === "string") {
        setSendPath(selected);
        setSendTicket(null);
      }
    } catch (e) {
      console.error("File selection error:", e);
    }
  }

  async function selectOutputDirectory() {
    try {
      const dir = await pick_directory_mobile();
      if (dir) {
        setReceiveOutputDir(dir);
      }
    } catch (e) {
      console.error("Directory selection error:", e);
    }
  }

  // Send/Receive handlers
  async function handleSend() {
    if (!sendPath() || isSending()) return;

    setIsSending(true);
    setSendTicket(null);

    try {
      const ticket = await send_file({ path: sendPath() });
      setSendTicket(ticket);
      await loadTransfers();
    } catch (e) {
      console.error("Send error:", e);
      toast.error(`Send failed: ${e}`);
    } finally {
      setIsSending(false);
    }
  }

  async function handleReceive() {
    if (!receiveTicket() || isReceiving()) return;

    setIsReceiving(true);
    setReceiveProgress(0);

    try {
      await receive_file({
        ticket: receiveTicket(),
        output_dir: receiveOutputDir() || undefined,
      });
      await loadTransfers();
      setReceiveTicket("");
    } catch (e) {
      console.error("Receive error:", e);
      toast.error(`Receive failed: ${e}`);
    } finally {
      setIsReceiving(false);
      setCurrentReceivingId(null);
    }
  }

  async function handleCancelSend() {
    if (currentSendingId()) {
      try {
        await cancel_transfer(currentSendingId()!);
        setCurrentSendingId(null);
      } catch (e) {
        console.error("Cancel error:", e);
      }
    }
  }

  async function handleCancelReceive() {
    if (currentReceivingId()) {
      try {
        await cancel_transfer(currentReceivingId()!);
        setCurrentReceivingId(null);
      } catch (e) {
        console.error("Cancel error:", e);
      }
    }
  }

  async function copyTicket() {
    if (sendTicket()) {
      await navigator.clipboard.writeText(sendTicket()!);
      toast.success("Ticket copied!");
    }
  }

  async function shareTicket() {
    if (sendTicket()) {
      try {
        await navigator.share({ text: sendTicket()! });
      } catch (e) {
        console.error("Share error:", e);
      }
    }
  }

  async function handleOpenFile(transfer: Transfer) {
    try {
      await open_received_file(transfer.id);
    } catch (e) {
      console.error("Open file error:", e);
    }
  }

  async function handleDeleteTransfer(transfer: Transfer) {
    try {
      const updated = transfers().filter((t) => t.id !== transfer.id);
      setTransfers(updated);
    } catch (e) {
      console.error("Delete error:", e);
    }
  }

  // Initialize
  onMount(async () => {
    // Check if mobile
    const currentPlatform = await platform();
    setIsMobile(currentPlatform === "android" || currentPlatform === "ios");

    // Load theme
    const savedTheme = localStorage.getItem("theme") as Theme | null;
    const initialTheme = savedTheme || "system";
    setTheme(initialTheme);
    applyTheme(initialTheme);

    // Load transfers
    await loadTransfers();

    setIsInitializing(false);

    // Listen for progress events
    const unlisten = await listen<ProgressUpdate>("progress", (event) => {
      const { event_type, data } = event.payload;

      if (event_type === "download") {
        setReceiveProgress(getProgressValue(data));
        if (data.stage === "connecting") {
          setCurrentReceivingId(data.transfer_id);
        } else if (data.stage === "completed") {
          setReceiveProgress(100);
          toast.success("Download completed!");
          setIsReceiving(false);
          setCurrentReceivingId(null);
        }
      }
    });

    onCleanup(() => {
      unlisten();
    });
  });

  // Render QR code
  const qrCodeUrl = () => {
    if (!sendTicket()) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(sendTicket()!)}`;
  };

  return (
    <div class="min-h-screen bg-[#120e26] pb-20">
      <Toaster position="top-center" />

      {/* Header */}
      <header class="sticky top-0 z-40 glass-liquid border-b border-white/5 px-4 py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-purple-500 to-indigo-600">
              <Sparkles size={20} class="text-white" />
            </div>
            <div>
              <h1 class="text-lg font-bold text-white">Sendme</h1>
              <p class="text-[10px] text-white/40 uppercase tracking-wider">P2P Transfer</p>
            </div>
          </div>

          <button
            onClick={toggleTheme}
            class="touch-button rounded-xl border border-white/5 bg-white/5 p-2.5 text-white/50 transition-all hover:bg-white/10 hover:text-white active:scale-95"
          >
            <Switch>
              <Match when={theme() === "light"}>
                <Sun size={18} />
              </Match>
              <Match when={theme() === "dark"}>
                <Moon size={18} />
              </Match>
              <Match when={theme() === "system"}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
              </Match>
            </Switch>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main class="p-4">
        <Presence>
          <Show when={activeTab() === "home"}>
            <Motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              class="space-y-4"
            >
              {/* Send Card */}
              <div class="glass-liquid rounded-2xl p-4 border border-white/10">
                <h2 class="flex items-center gap-2 text-base font-semibold text-white mb-3">
                  <Send size={18} class="text-purple-400" />
                  Send Files
                </h2>

                {/* File Selection */}
                <div
                  onClick={selectFile}
                  class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/10 bg-white/5 p-4 transition-all hover:border-purple-500/30 active:scale-98"
                >
                  <FolderOpen size={32} class="text-white/40 mb-2" />
                  <span class="text-sm text-white/60">
                    {sendPath() ? getDisplayName(sendPath()) : "Tap to select file"}
                  </span>
                </div>

                {/* Send Button */}
                <button
                  onClick={handleSend}
                  disabled={!sendPath() || isSending()}
                  class="touch-active mt-3 w-full flex h-12 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-purple-600 to-indigo-600 font-semibold text-white transition-all hover:shadow-lg hover:shadow-purple-500/25 disabled:opacity-50"
                >
                  <Show when={isSending()} fallback={<><Zap size={18} /> Generate Ticket</>}>
                    <Loader2 size={18} class="animate-spin" />
                  </Show>
                </button>

                {/* Ticket Display */}
                <Show when={sendTicket()}>
                  <Motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    class="mt-3 overflow-hidden"
                  >
                    <div class="glass-inset rounded-xl p-3">
                      <div class="flex items-center justify-between mb-2">
                        <span class="text-xs text-white/50">Ticket</span>
                        <div class="flex gap-2">
                          <button onClick={copyTicket} class="p-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white">
                            <Copy size={14} />
                          </button>
                          <Show when={isMobile()}>
                            <button onClick={shareTicket} class="p-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white">
                              <Share2 size={14} />
                            </button>
                          </Show>
                        </div>
                      </div>
                      <p class="font-mono text-xs text-white/80 break-all">{sendTicket()}</p>
                    </div>

                    {/* QR Code */}
                    <Show when={qrCodeUrl()}>
                      <div class="mt-3 flex justify-center">
                        <div class="glass rounded-xl p-2">
                          <img src={qrCodeUrl()} alt="QR Code" class="w-32 h-32 rounded-lg" />
                        </div>
                      </div>
                    </Show>
                  </Motion.div>
                </Show>
              </div>

              {/* Receive Card */}
              <div class="glass-liquid rounded-2xl p-4 border border-white/10">
                <h2 class="flex items-center gap-2 text-base font-semibold text-white mb-3">
                  <Download size={18} class="text-indigo-400" />
                  Receive Files
                </h2>

                {/* Ticket Input */}
                <input
                  type="text"
                  value={receiveTicket()}
                  onInput={(e) => setReceiveTicket(e.currentTarget.value)}
                  placeholder="Paste ticket here"
                  class="w-full h-12 rounded-xl border border-white/5 bg-white/5 px-4 pr-12 font-mono text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50"
                />

                {/* Scan Button */}
                <Show when={isMobile()}>
                  <button
                    class="touch-active mt-2 w-full flex h-10 items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/5 text-white/60 text-sm transition-all hover:bg-white/10 hover:text-white"
                  >
                    <Scan size={16} />
                    Scan QR Code
                  </button>
                </Show>

                {/* Output Directory */}
                <div class="mt-3 flex gap-2">
                  <div class="flex-1 flex items-center rounded-xl border border-white/5 bg-white/5 px-3 h-10">
                    <span class="text-xs text-white/50 truncate">
                      {receiveOutputDir() || "Default location"}
                    </span>
                  </div>
                  <button
                    onClick={selectOutputDirectory}
                    class="touch-active flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-white/60 transition-all hover:bg-white/10 hover:text-white"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>

                {/* Receive Button */}
                <button
                  onClick={handleReceive}
                  disabled={!receiveTicket() || isReceiving()}
                  class="touch-active mt-3 w-full flex h-12 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-indigo-600 to-purple-600 font-semibold text-white transition-all hover:shadow-lg hover:shadow-indigo-500/25 disabled:opacity-50"
                >
                  <Show when={isReceiving()} fallback={<><Download size={18} /> Connect & Receive</>}>
                    <Loader2 size={18} class="animate-spin" />
                    {receiveProgress()}%
                  </Show>
                </button>
              </div>
            </Motion.div>
          </Show>

          <Show when={activeTab() === "history"}>
            <Motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <h2 class="text-base font-semibold text-white mb-3">Transfer History</h2>

              <Show when={transfers().length > 0} fallback={
                <div class="glass-liquid rounded-2xl p-8 text-center border border-white/10">
                  <History size={40} class="mx-auto text-white/20 mb-3" />
                  <p class="text-white/40 text-sm">No transfers yet</p>
                </div>
              }>
                <div class="space-y-2">
                  <For each={transfers()}>
                    {(transfer) => (
                      <div class="glass-liquid rounded-xl p-3 border border-white/5">
                        <div class="flex items-center gap-3">
                          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
                            {getFileIcon(transfer.transfer_type === "send" ? "file" : "download")}
                          </div>
                          <div class="flex-1 min-w-0">
                            <p class="text-sm font-medium text-white truncate">{getDisplayName(transfer.path)}</p>
                            <p class="text-xs text-white/40">{formatDate(transfer.created_at)}</p>
                          </div>
                          <div class="flex items-center gap-2">
                            <span class={`text-xs px-2 py-1 rounded-full ${
                              transfer.status === "completed"
                                ? "bg-green-500/20 text-green-400"
                                : transfer.status === "error"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-yellow-500/20 text-yellow-400"
                            }`}>
                              {getTransferStatus(transfer.status)}
                            </span>
                            <button
                              onClick={() => handleDeleteTransfer(transfer)}
                              class="p-1.5 rounded-lg text-white/40 hover:text-red-400"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Motion.div>
          </Show>

          <Show when={activeTab() === "settings"}>
            <Motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <h2 class="text-base font-semibold text-white mb-3">Settings</h2>

              <div class="space-y-3">
                <div class="glass-liquid rounded-xl p-4 border border-white/5">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium text-white">Theme</p>
                      <p class="text-xs text-white/40">Choose appearance</p>
                    </div>
                    <div class="flex gap-1 p-1 rounded-lg bg-white/5">
                      <For each={["light", "dark", "system"] as Theme[]}>
                        {(t) => (
                          <button
                            onClick={() => setThemeValue(t)}
                            class={`px-3 py-1.5 rounded-md text-xs transition-all ${
                              theme() === t
                                ? "bg-purple-500/20 text-purple-400"
                                : "text-white/40 hover:text-white"
                            }`}
                          >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </div>
            </Motion.div>
          </Show>
        </Presence>
      </main>

      {/* Bottom Navigation */}
      <nav class="fixed bottom-0 left-0 right-0 glass-liquid border-t border-white/5 pb-safe z-50">
        <div class="flex items-center justify-around h-16 px-4">
          <button
            onClick={() => setActiveTab("home")}
            class={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
              activeTab() === "home" ? "text-purple-400" : "text-white/40"
            }`}
          >
            <Home size={20} />
            <span class="text-[10px]">Home</span>
          </button>

          <button
            onClick={() => setActiveTab("history")}
            class={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
              activeTab() === "history" ? "text-purple-400" : "text-white/40"
            }`}
          >
            <History size={20} />
            <span class="text-[10px]">History</span>
          </button>

          <button
            onClick={() => setActiveTab("settings")}
            class={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
              activeTab() === "settings" ? "text-purple-400" : "text-white/40"
            }`}
          >
            <Settings size={20} />
            <span class="text-[10px]">Settings</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

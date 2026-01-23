import { createSignal, onMount, onCleanup, For, Show, Switch, Match } from "solid-js";
import {
  send_file,
  receive_file,
  cancel_transfer,
  get_transfers,
  clear_transfers,
  open_received_file,
  pick_directory,
} from "~/bindings";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { platform } from "@tauri-apps/plugin-os";
import { scan, Format, checkPermissions, requestPermissions } from "@tauri-apps/plugin-barcode-scanner";
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
  Monitor,
  Sun,
  Moon,
  Trash2,
  Scan,
  Sparkles,
  Shield,
  Zap,
} from "lucide-solid";
import { Toaster, toast } from "solid-sonner";
import { formatFileSize, formatDate, getDisplayName, getFileIcon, getTransferStatus, getProgressValue } from "~/lib/utils";

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

export default function Home() {
  // Tab state
  const [activeTab, setActiveTab] = createSignal<"send" | "receive">("send");

  // Transfers state
  const [transfers, setTransfers] = createSignal<Transfer[]>([]);

  // Send state
  const [sendPath, setSendPath] = createSignal("");
  const [sendTicketType, setSendTicketType] = createSignal("relay_and_addresses");
  const [sendTicket, setSendTicket] = createSignal("");
  const [sendTicketQrCode, setSendTicketQrCode] = createSignal("");
  const [isSending, setIsSending] = createSignal(false);
  const [showTicketPopover, setShowTicketPopover] = createSignal(false);

  // Receive state
  const [receiveTicket, setReceiveTicket] = createSignal("");
  const [receiveOutputDir, setReceiveOutputDir] = createSignal("");
  const [isReceiving, setIsReceiving] = createSignal(false);
  const [currentReceivingId, setCurrentReceivingId] = createSignal<string | null>(null);

  // Progress state
  const [progressData, setProgressData] = createSignal<Record<string, ProgressData>>({});
  const [metadataCache, setMetadataCache] = createSignal<Record<string, any>>({});

  // Mobile state
  const [isMobile, setIsMobile] = createSignal(false);

  // Theme state
  const [theme, setTheme] = createSignal<Theme>("system");

  // Interaction state
  const [mousePos, setMousePos] = createSignal({ x: 0, y: 0 });

  // Computed: receive progress
  const receiveProgress = () => {
    if (!currentReceivingId()) {
      return 0;
    }
    const data = progressData()[currentReceivingId()!];
    if (!data?.progress) {
      return 0;
    }

    // When downloading, show actual progress
    if (data.progress.type === "downloading") {
      return (data.progress.offset / data.progress.total) * 100;
    }

    // When completed, show 100%
    if (data.progress.type === "completed") {
      return 100;
    }

    // For other states (metadata, connecting, etc.), show 0
    return 0;
  };

  // Theme functions
  function setThemeValue(newTheme: Theme) {
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);

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
      // Sort by created_at descending (newest first)
      setTransfers(loaded.sort((a, b) => b.created_at - a.created_at));
    } catch (e) {
      console.error("Failed to load transfers:", e);
    }
  }

  // File picker functions
  async function selectFile() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
      });
      if (selected && typeof selected === "string") {
        setSendPath(selected);
      }
    } catch (e) {
      console.error("Failed to select file:", e);
    }
  }

  async function selectDirectory() {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });
      if (selected && typeof selected === "string") {
        setSendPath(selected);
      }
    } catch (e) {
      console.error("Failed to select directory:", e);
    }
  }

  async function selectOutputDirectory() {
    try {
      if (isMobile()) {
        const result = await pick_directory();
        handleSetReceiveOutputDir(result.uri);
      } else {
        const selected = await open({
          multiple: false,
          directory: true,
        });
        if (selected && typeof selected === "string") {
          handleSetReceiveOutputDir(selected);
        }
      }
    } catch (e: any) {
      console.error("Failed to select output directory:", e);
      toast.error("Failed to select folder", {
        description: String(e),
      });
    }
  }

  // Send/Receive handlers
  async function handleSend() {
    if (!sendPath()) {
      return;
    }

    setIsSending(true);
    setSendTicket("");
    setSendTicketQrCode("");

    try {
      const result = await send_file({
        path: sendPath(),
        ticket_type: sendTicketType(),
      });
      setSendTicket(result);
      // Generate QR code for the ticket
      setSendTicketQrCode(
        await QRCode.toDataURL(result, {
          errorCorrectionLevel: "H",
          width: 300,
        })
      );
      await loadTransfers();
    } catch (e) {
      console.error("Send failed:", e);
      toast.error(`Send failed: ${e}`);
    } finally {
      setIsSending(false);
    }
  }

  async function handleReceive() {
    if (!receiveTicket()) {
      return;
    }

    setIsReceiving(true);
    setCurrentReceivingId(null);

    try {
      await receive_file({
        ticket: receiveTicket(),
        output_dir: receiveOutputDir() || undefined,
      });
      await loadTransfers();
      setReceiveTicket("");
      toast.success("Receive operation started");
    } catch (e) {
      console.error("Receive failed:", e);
      toast.error(`Receive failed: ${e}`);
      setCurrentReceivingId(null);
    } finally {
      setIsReceiving(false);
    }
  }

  async function handleCancelReceive() {
    if (currentReceivingId()) {
      await handleCancel(currentReceivingId()!);
      setCurrentReceivingId(null);
    }
  }

  async function handleScanBarcode() {
    try {
      // Check and request camera permission before scanning
      let permissionStatus = await checkPermissions();
      if (permissionStatus !== 'granted') {
        permissionStatus = await requestPermissions();
      }

      if (permissionStatus !== 'granted') {
        toast.error('Camera permission is required to scan QR codes');
        return;
      }

      // Use the barcode scanner plugin directly
      const result = await scan({ formats: [Format.QRCode] });
      if (result && result.content) {
        setReceiveTicket(result.content);
      }
    } catch (e) {
      console.error("Scan failed:", e);
      toast.error(`Scan failed: ${e}`);
    }
  }

  async function handleCancel(id: string) {
    try {
      await cancel_transfer(id);
      await loadTransfers();
      toast.info("Transfer cancelled");
    } catch (e) {
      console.error("Cancel failed:", e);
      toast.error("Failed to cancel transfer");
    }
  }

  async function handleClearTransfers() {
    try {
      await clear_transfers();
      setTransfers([]);
      toast.success("History cleared successfully");
    } catch (e) {
      console.error("Clear failed:", e);
      toast.error("Failed to clear history");
    }
  }

  async function handleOpenFile(transfer: Transfer) {
    // Only allow opening completed receive transfers
    if (transfer.transfer_type !== "receive") {
      toast.error("Can only open received files");
      return;
    }

    if (!transfer.status.includes("complete")) {
      toast.error("Can only open completed transfers");
      return;
    }

    try {
      await open_received_file(transfer.id);
    } catch (e) {
      console.error("Failed to open file:", e);
      toast.error(`Failed to open file: ${e}`);
    }
  }

  function getTransferDisplayName(transfer: Transfer): string {
    const meta = metadataCache()[transfer.id];
    if (
      transfer.transfer_type === "receive" &&
      meta?.names?.length > 0
    ) {
      const names = meta.names;
      if (names.length === 1) {
        return names[0];
      }
      return `${names[0]} (+${names.length - 1} more)`;
    }
    return getDisplayName(transfer.path);
  }

  function getTransferFileIcon(transfer: Transfer) {
    const meta = metadataCache()[transfer.id];
    if (
      transfer.transfer_type === "receive" &&
      meta?.names?.length > 0
    ) {
      const iconName = getFileIcon(meta.names[0]);
      switch (iconName) {
        case "FileImage": return FileImage;
        case "FileArchive": return FileArchive;
        case "FileCode": return FileCode;
        default: return FileText;
      }
    }
    const iconName = getFileIcon(transfer.path);
    switch (iconName) {
      case "FileImage": return FileImage;
      case "FileArchive": return FileArchive;
      case "FileCode": return FileCode;
      default: return FileText;
    }
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Ticket copied to clipboard");
  }

  const shareText = (text: string) => {
    if (navigator.share) {
      navigator.share({
        title: 'PiSend Ticket',
        text: text,
      })
      .then(() => console.log('Successful share'))
      .catch((error) => console.log('Error sharing', error));
    } else {
      copyToClipboard(text);
    }
  };

  // Load output directory from localStorage on mount
  onMount(async () => {
    // Initialize theme from localStorage or default to system
    const savedTheme = localStorage.getItem("theme") as Theme | null;
    setThemeValue(savedTheme || "system");

    // Load output directory from localStorage
    const savedOutputDir = localStorage.getItem("receive-output-dir");
    if (savedOutputDir) {
      setReceiveOutputDir(savedOutputDir);
    }

    // Load transfers
    await loadTransfers();

    // Detect mobile platform
    const currentPlatform = await platform();
    setIsMobile(currentPlatform === "android" || currentPlatform === "ios");

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);

    // Listen for progress events
    const unlisten = await listen<ProgressUpdate>("progress", (event) => {
      const { transfer_id, ...data } = event.payload.data;
      setProgressData((prev) => ({
        ...prev,
        [transfer_id]: { transfer_id, ...data },
      }));

      // Auto-track receiving transfers
      if (!currentReceivingId() && data.progress?.type === "metadata") {
        setCurrentReceivingId(transfer_id);
      }

      // Clear currentReceivingId when download completes
      if (
        currentReceivingId() === transfer_id &&
        data.progress?.type === "completed"
      ) {
        // Keep showing for a moment then clear
        setTimeout(() => {
          if (currentReceivingId() === transfer_id) {
            setCurrentReceivingId(null);
          }
        }, 2000);
      }

      // Cache metadata when it arrives
      if (data.progress?.type === "metadata") {
        setMetadataCache((prev) => ({
          ...prev,
          [transfer_id]: data.progress,
        }));
      }
    });

    // Cleanup on unmount
    onCleanup(() => {
      unlisten();
      window.removeEventListener("mousemove", handleMouseMove);
    });
  });

  const handleSetReceiveOutputDir = (value: string) => {
    setReceiveOutputDir(value);
    localStorage.setItem("receive-output-dir", value);
  };

  return (
    <>
      <Toaster />

      {/* Dynamic Background */}
      <div class="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <Motion.div
          animate={{
            x: mousePos().x * 0.05,
            y: mousePos().y * 0.05,
          }}
          transition={{ duration: 2, easing: "ease-out" }}
          class="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-600/10 rounded-full blur-[120px]"
        />
        <Motion.div
          animate={{
            x: mousePos().x * -0.03,
            y: mousePos().y * -0.03,
          }}
          transition={{ duration: 2, easing: "ease-out" }}
          class="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-indigo-600/10 rounded-full blur-[120px]"
        />
        <div class="absolute inset-0 bg-animate opacity-50" />
      </div>

      <main class="min-h-screen relative z-10 flex flex-col items-center px-4 py-8">
        <div class="w-full max-w-2xl space-y-10">
          {/* Header */}
          <header class="flex items-center justify-between">
            <Motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              class="flex items-center gap-4 group"
            >
              <div class="w-12 h-12 rounded-2xl bg-linear-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-all">
                <Sparkles size={24} class="text-white" />
              </div>
              <div>
                <h1 class="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-white to-white/60">
                  PiSend
                </h1>
                <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">Secure P2P Node</p>
              </div>
            </Motion.div>

            <div class="flex items-center gap-2">
              <Motion.button
                hover={{ scale: 1.05, backgroundColor: "rgba(255, 255, 255, 0.1)" }}
                press={{ scale: 0.95 }}
                onClick={toggleTheme}
                class="p-2.5 rounded-xl bg-white/5 border border-white/5 text-white/50 hover:text-white transition-all"
                title={`Current theme: ${theme()}`}
              >
                <Switch>
                  <Match when={theme() === 'light'}><Sun class="w-5 h-5" /></Match>
                  <Match when={theme() === 'dark'}><Moon class="w-5 h-5" /></Match>
                  <Match when={theme() === 'system'}><Monitor class="w-5 h-5" /></Match>
                </Switch>
              </Motion.button>
            </div>
          </header>

          {/* Main Card */}
          <section class="glass rounded-3xl overflow-hidden border border-white/10 shadow-2xl relative">
            {/* Tabs */}
            <div class="flex p-2 bg-white/5 border-b border-white/5">
              <button
                onClick={() => setActiveTab("send")}
                class={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl transition-all relative overflow-hidden ${
                  activeTab() === "send"
                    ? "text-white"
                    : "text-white/40 hover:text-white/60 hover:bg-white/5"
                }`}
              >
                <Show when={activeTab() === "send"}>
                  <div class="absolute inset-0 bg-linear-to-r from-purple-500/20 to-indigo-500/20 z-0" />
                </Show>
                <Send size={18} class="relative z-10" />
                <span class="font-semibold relative z-10">Send</span>
              </button>
              <button
                onClick={() => setActiveTab("receive")}
                class={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl transition-all relative overflow-hidden ${
                  activeTab() === "receive"
                    ? "text-white"
                    : "text-white/40 hover:text-white/60 hover:bg-white/5"
                }`}
              >
                <Show when={activeTab() === "receive"}>
                  <div class="absolute inset-0 bg-linear-to-r from-purple-500/20 to-indigo-500/20 z-0" />
                </Show>
                <Download size={18} class="relative z-10" />
                <span class="font-semibold relative z-10">Receive</span>
              </button>
            </div>

            <div class="p-8">
              <Presence>
                <Switch>
                  <Match when={activeTab() === "send"}>
                    <Motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      class="space-y-6"
                    >
                      <div class="space-y-4">
                        <div 
                          class="group relative flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-3xl p-10 bg-white/2 hover:bg-white/4 hover:border-purple-500/30 transition-all cursor-pointer"
                          onClick={selectFile}
                        >
                          <div class="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <FolderOpen class="text-purple-400" size={32} />
                          </div>
                          <h3 class="text-lg font-semibold text-white">
                            {sendPath() ? getDisplayName(sendPath()) : "Share a file"}
                          </h3>
                          <p class="text-sm text-white/40 mt-1">
                            {sendPath() ? "Tap to change file" : "Tap to select a file from your device"}
                          </p>
                        </div>

                        <div class="flex gap-3">
                          <button
                            onClick={selectDirectory}
                            disabled={isSending()}
                            class="flex-1 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 border border-white/5 transition-all text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <FolderOpen size={16} />
                            Directory
                          </button>
                          
                          <div class="relative flex-1">
                            <button
                              onClick={() => setShowTicketPopover(!showTicketPopover())}
                              disabled={isSending()}
                              class="w-full py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 border border-white/5 transition-all text-sm font-medium flex items-center justify-between disabled:opacity-50"
                            >
                              <span class="truncate">
                                {ticketTypes.find((t) => t.value === sendTicketType())?.label}
                              </span>
                              <ChevronRight size={14} class="opacity-40" />
                            </button>
                            <Show when={showTicketPopover()}>
                              <div class="absolute z-50 w-64 p-2 glass rounded-2xl border border-white/10 mt-2 right-0 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                <For each={ticketTypes}>
                                  {(type) => (
                                    <button
                                      onClick={() => {
                                        setSendTicketType(type.value as any);
                                        setShowTicketPopover(false);
                                      }}
                                      class={`w-full text-left px-3 py-2 rounded-xl transition-all ${
                                        sendTicketType() === type.value
                                          ? "bg-white/10 text-white"
                                          : "text-white/40 hover:text-white/60 hover:bg-white/5"
                                      }`}
                                    >
                                      <div class="font-semibold text-xs">{type.label}</div>
                                      <div class="text-[10px] opacity-60 mt-0.5">{type.description}</div>
                                    </button>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </div>
                      </div>

                      <Motion.button
                        hover={{ scale: 1.02 }}
                        press={{ scale: 0.98 }}
                        onClick={handleSend}
                        disabled={!sendPath() || isSending()}
                        class="w-full h-14 bg-linear-to-r from-purple-600 to-indigo-600 rounded-2xl font-bold text-white shadow-xl shadow-purple-500/20 hover:shadow-purple-500/40 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                      >
                        {isSending() ? (
                          <Loader2 class="animate-spin" size={20} />
                        ) : (
                          <>
                            <Zap size={20} />
                            Generate Ticket
                          </>
                        )}
                      </Motion.button>

                      <Presence>
                        <Show when={sendTicket()}>
                          <Motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            class="space-y-6 pt-6 border-t border-white/5"
                          >
                            <div class="flex flex-col items-center gap-6">
                              <Show when={sendTicketQrCode()}>
                                <div class="p-4 bg-white rounded-3xl shadow-2xl">
                                  <img src={sendTicketQrCode()!} alt="QR" class="w-48 h-48" />
                                </div>
                              </Show>
                              
                              <div class="w-full space-y-3">
                                <div class="glass-inset rounded-2xl p-4 flex flex-col gap-2">
                                  <label class="text-[10px] uppercase tracking-widest text-white/30 font-bold">Transfer Ticket</label>
                                  <div class="flex items-center gap-3">
                                    <code class="flex-1 text-sm font-mono text-purple-200 truncate bg-purple-500/10 px-3 py-2 rounded-lg">
                                      {sendTicket()}
                                    </code>
                                    <button 
                                      onClick={() => copyToClipboard(sendTicket()!)}
                                      class="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-colors text-white/60 hover:text-white"
                                    >
                                      <Copy size={18} />
                                    </button>
                                  </div>
                                </div>
                                
                                <Show when={isMobile()}>
                                  <button 
                                    onClick={() => shareText(sendTicket()!)}
                                    class="w-full py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-white font-semibold transition-all flex items-center justify-center gap-2"
                                  >
                                    <Share2 size={18} />
                                    Share with Friends
                                  </button>
                                </Show>
                              </div>
                            </div>
                          </Motion.div>
                        </Show>
                      </Presence>
                    </Motion.div>
                  </Match>

                  <Match when={activeTab() === "receive"}>
                    <Motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      class="space-y-6"
                    >
                      <div class="space-y-4">
                        <div class="space-y-2">
                          <label class="text-xs font-bold uppercase tracking-widest text-white/30 ml-1">Universal Ticket</label>
                          <div class="flex gap-2">
                            <div class="relative flex-1">
                              <input
                                value={receiveTicket()}
                                onInput={(e) => setReceiveTicket(e.currentTarget.value)}
                                placeholder="Paste ticket code..."
                                class="w-full h-14 bg-white/5 border border-white/5 rounded-2xl pl-12 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 transition-all font-mono text-sm"
                              />
                              <Shield class="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={20} />
                            </div>
                            <Show when={isMobile()}>
                              <button 
                                onClick={handleScanBarcode}
                                class="w-14 h-14 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center text-white/60 hover:text-white transition-all border border-white/5"
                              >
                                <Scan size={20} />
                              </button>
                            </Show>
                          </div>
                        </div>

                        <div class="space-y-2">
                          <label class="text-xs font-bold uppercase tracking-widest text-white/30 ml-1">Destination</label>
                          <div class="flex gap-2">
                            <div class="relative flex-1">
                              <input
                                readOnly
                                value={receiveOutputDir() || "Default Downloads"}
                                class="w-full h-14 bg-white/5 border border-white/5 rounded-2xl pl-12 pr-4 text-white/50 text-sm focus:outline-none"
                              />
                              <FolderOpen class="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={20} />
                            </div>
                            <button 
                              onClick={selectOutputDirectory}
                              class="w-14 h-14 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center text-white/60 hover:text-white transition-all border border-white/5"
                            >
                              <ChevronRight size={20} />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div class="relative group">
                        <Motion.button
                          hover={{ scale: 1.02 }}
                          press={{ scale: 0.98 }}
                          onClick={() => currentReceivingId() ? handleCancelReceive() : handleReceive()}
                          disabled={!receiveTicket() || (isReceiving() && !currentReceivingId())}
                          class={`w-full h-14 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-xl ${
                            currentReceivingId() 
                              ? "bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20" 
                              : "bg-linear-to-r from-indigo-600 to-purple-600 text-white shadow-indigo-500/20 hover:shadow-indigo-500/40"
                          }`}
                        >
                          <Show when={currentReceivingId()} fallback={
                            <>
                              {isReceiving() ? <Loader2 class="animate-spin" size={20} /> : <Download size={20} />}
                              {isReceiving() ? "Connecting..." : "Connect & Receive"}
                            </>
                          }>
                            <span class="group-hover:hidden">{Math.round(receiveProgress())}% Receiving...</span>
                            <span class="hidden group-hover:flex items-center gap-2">
                              <X size={18} /> Cancel Transfer
                            </span>
                          </Show>
                        </Motion.button>
                      </div>
                    </Motion.div>
                  </Match>
                </Switch>
              </Presence>
            </div>
          </section>

          {/* Activity List */}
          <section class="space-y-6">
            <div class="flex items-center justify-between px-2">
              <h2 class="text-xl font-bold text-white flex items-center gap-2">
                Activity
                <span class="px-2 py-0.5 bg-white/5 rounded-lg text-xs text-white/40">{transfers().length}</span>
              </h2>
              <div class="flex items-center gap-4">
                <button onClick={loadTransfers} class="text-xs font-bold uppercase tracking-wider text-white/30 hover:text-purple-400 transition-colors flex items-center gap-2">
                  <RefreshCw size={14} /> Sync
                </button>
                <Show when={transfers().length > 0}>
                  <button onClick={handleClearTransfers} class="text-xs font-bold uppercase tracking-wider text-red-400/50 hover:text-red-400 transition-colors flex items-center gap-2">
                    <Trash2 size={14} /> Clear
                  </button>
                </Show>
              </div>
            </div>

            <Presence>
              <Show when={transfers().length > 0} fallback={
                <Motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  class="glass rounded-3xl p-12 flex flex-col items-center justify-center text-center space-y-4 border border-white/5"
                >
                  <div class="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-white/10">
                    <Share2 size={32} />
                  </div>
                  <div>
                    <p class="text-white font-medium">No activity yet</p>
                    <p class="text-sm text-white/20">Your shared and received files will appear here</p>
                  </div>
                </Motion.div>
              }>
                <div class="grid grid-cols-1 gap-4">
                  <For each={transfers()}>
                    {(transfer) => {
                      const status = getTransferStatus(transfer.status);
                      const Icon = getTransferFileIcon(transfer);
                      const progress = () => progressData()[transfer.id];
                      const meta = () => metadataCache()[transfer.id];

                      return (
                        <Motion.div 
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          class="glass group p-4 rounded-2xl border border-white/5 hover:border-white/10 transition-all"
                        >
                          <div class="flex items-center gap-4">
                            <div class={`w-12 h-12 rounded-xl flex items-center justify-center ${
                              transfer.transfer_type === 'send' 
                                ? 'bg-purple-500/10 text-purple-400' 
                                : 'bg-indigo-500/10 text-indigo-400'
                            }`}>
                              <Icon size={24} />
                            </div>
                            
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center justify-between gap-4">
                                <h4 
                                  onClick={() => handleOpenFile(transfer)}
                                  class={`font-semibold text-white truncate ${
                                    transfer.transfer_type === 'receive' && transfer.status.includes('complete') ? 'cursor-pointer hover:text-purple-400 hover:underline' : ''
                                  }`}
                                >
                                  {getTransferDisplayName(transfer)}
                                </h4>
                                <span class={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                                  transfer.transfer_type === 'send' ? 'bg-purple-500/20 text-purple-300' : 'bg-indigo-500/20 text-indigo-300'
                                }`}>
                                  {transfer.transfer_type}
                                </span>
                              </div>
                              
                              <div class="flex items-center gap-3 mt-1 underline-offset-4">
                                <div class={`text-[11px] font-medium flex items-center gap-1 ${status.color}`}>
                                  <div class={status.pulse ? 'animate-pulse' : ''}>
                                    <Switch>
                                      <Match when={status.icon === 'Check'}><Check size={12} /></Match>
                                      <Match when={status.icon === 'X'}><X size={12} /></Match>
                                      <Match when={status.icon === 'Share2'}><Share2 size={12} /></Match>
                                      <Match when={status.icon === 'Download'}><Download size={12} /></Match>
                                      <Match when={true}><RefreshCw size={12} class="animate-spin" /></Match>
                                    </Switch>
                                  </div>
                                  {status.label}
                                </div>
                                <span class="text-white/10">•</span>
                                <span class="text-[11px] text-white/30">{formatDate(transfer.created_at)}</span>
                              </div>

                              <Show when={progress() || meta()}>
                                <div class="mt-4 pt-4 border-t border-white/5 space-y-3">
                                  <Show when={meta()}>
                                    <div class="text-[10px] text-white/40 flex gap-4">
                                      <span class="flex items-center gap-1"><FileText size={10} /> {meta()?.file_count || 0} files</span>
                                      <span>{formatFileSize(meta()?.total_size || 0)}</span>
                                    </div>
                                  </Show>

                                  <Show when={progress()?.progress?.type === 'downloading'}>
                                    <div class="space-y-1.5">
                                      <div class="flex justify-between text-[10px] text-white/40">
                                        <span class="truncate pr-4">{progress()?.name}</span>
                                        <span>{Math.round(getProgressValue(progress() || {}))}%</span>
                                      </div>
                                      <div class="h-1 bg-white/5 rounded-full overflow-hidden">
                                        <div 
                                          class="h-full bg-linear-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                                          style={{ width: `${getProgressValue(progress() || {})}%` }}
                                        />
                                      </div>
                                    </div>
                                  </Show>
                                </div>
                              </Show>
                            </div>

                            <Show when={!transfer.status.includes('complete') && !transfer.status.includes('error') && !transfer.status.includes('cancel')}>
                              <button 
                                onClick={() => handleCancel(transfer.id)}
                                class="p-2 text-white/20 hover:text-red-400 transition-colors"
                              >
                                <X size={18} />
                              </button>
                            </Show>
                          </div>
                        </Motion.div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </Presence>
          </section>
        </div>
      </main>
    </>
  );
}

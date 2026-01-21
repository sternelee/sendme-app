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
        setReceiveOutputDir(result.uri);
      } else {
        const selected = await open({
          multiple: false,
          directory: true,
        });
        if (selected && typeof selected === "string") {
          setReceiveOutputDir(selected);
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
        title: 'Sendme Ticket',
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
    });
  });

  // Save output directory to localStorage when it changes
  const handleSetReceiveOutputDir = (value: string) => {
    setReceiveOutputDir(value);
    localStorage.setItem("receive-output-dir", value);
  };

  return (
    <>
      <Toaster />

      <div class="fixed inset-0 pointer-events-none overflow-hidden blur-[120px] opacity-20 dark:opacity-40">
        <div class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500 rounded-full animate-pulse"></div>
        <div class="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500 rounded-full animate-pulse" style="animation-delay: 2s"></div>
      </div>

      <main class="min-h-screen relative flex items-center justify-center p-4">
        <div class="w-full max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          {/* Header */}
          <header class="relative mt-10 md:mt-2">
            <div class="text-center space-y-2">
              <h1 class="text-4xl sm:text-5xl font-extrabold tracking-tighter text-slate-900 dark:text-slate-50 text-glow">
                Sendme
              </h1>
              <p class="text-slate-500 dark:text-slate-400 font-medium tracking-wide">
                PEER-TO-PEER • POWERED BY IROH
              </p>
            </div>
            <button
              onClick={toggleTheme}
              class="absolute top-0 right-0 p-2 rounded-xl hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
              title={`Current theme: ${theme()}`}
              type="button"
            >
              <Switch>
                <Match when={theme() === 'light'}><Sun class="w-5 h-5 text-slate-700" /></Match>
                <Match when={theme() === 'dark'}><Moon class="w-5 h-5 text-slate-300" /></Match>
                <Match when={theme() === 'system'}><Monitor class="w-5 h-5 text-slate-700 dark:text-slate-300" /></Match>
              </Switch>
            </button>
          </header>

          {/* Main Container */}
          <div class="glass rounded-2xl sm:rounded-3xl overflow-hidden">
            <div class="flex w-full h-auto bg-transparent p-2 gap-2 border-b border-white/10">
              <button
                onClick={() => setActiveTab('send')}
                class="flex-1 py-3 text-sm font-semibold rounded-xl transition-all text-slate-600 dark:text-slate-400"
                classList={{
                  'bg-white/10': activeTab() === 'send',
                  'text-secondary-foreground dark:text-white': activeTab() === 'send',
                  'shadow-sm': activeTab() === 'send',
                }}
                type="button"
              >
                <Send class="w-4 h-4 mr-2 inline-block" />
                Send
              </button>
              <button
                onClick={() => setActiveTab('receive')}
                class="flex-1 py-3 text-sm font-semibold rounded-xl transition-all text-slate-600 dark:text-slate-400"
                classList={{
                  'bg-white/10': activeTab() === 'receive',
                  'text-secondary-foreground dark:text-white': activeTab() === 'receive',
                  'shadow-sm': activeTab() === 'receive',
                }}
                type="button"
              >
                <Download class="w-4 h-4 mr-2 inline-block" />
                Receive
              </button>
            </div>

            <div class="p-4 sm:p-6 md:p-8">
              {/* Send Tab */}
              <Show when={activeTab() === 'send'}>
                <div class="space-y-6">
                  {/* Drop Zone Area */}
                  <div
                    class="group relative flex flex-col items-center justify-center p-6 sm:p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl hover:border-primary/50 hover:bg-white/5 transition-all cursor-pointer"
                    onClick={selectFile}
                    onKeyPress={(e) => e.key === 'Enter' && selectFile()}
                    tabindex="0"
                    role="button"
                  >
                    <div class="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <FolderOpen class="w-8 h-8 text-primary" />
                    </div>
                    <Show when={!sendPath()} fallback={
                      <>
                        <h3 class="font-semibold text-primary text-center break-all text-lg">
                          {getDisplayName(sendPath())}
                        </h3>
                        <p class="text-sm text-slate-500 dark:text-slate-500 mt-1 truncate max-w-[80%]">
                          {sendPath()}
                        </p>
                      </>
                    }>
                      <h3 class="font-semibold text-slate-900 dark:text-slate-200 text-lg">
                        Click to select a file
                      </h3>
                      <p class="text-sm text-slate-500 dark:text-slate-500 mt-1">
                        or select a directory below
                      </p>
                    </Show>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={selectDirectory}
                      disabled={isSending()}
                      class="h-12 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground disabled:opacity-50 transition-colors"
                    >
                      <FolderOpen class="h-4 w-4 mr-2 inline-block" />
                      Select Directory
                    </button>
                    <div class="relative">
                      <button
                        type="button"
                        class="h-12 rounded-xl justify-between w-full px-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground disabled:opacity-50 flex items-center transition-colors"
                        disabled={isSending()}
                        onClick={() => setShowTicketPopover(!showTicketPopover())}
                      >
                        <span class="truncate">
                          {ticketTypes.find((t) => t.value === sendTicketType())?.label}
                        </span>
                        <ChevronRight class="h-4 w-4 opacity-50 ml-1" />
                      </button>
                      <Show when={showTicketPopover()}>
                        <div
                          class="absolute z-10 w-64 p-2 glass-card rounded-2xl border-white/10 mt-2 right-0 shadow-lg"
                        >
                          <div class="space-y-1">
                            <For each={ticketTypes}>
                              {(type) => (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSendTicketType(type.value);
                                    setShowTicketPopover(false);
                                  }}
                                  class="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 transition-all"
                                  classList={{
                                    'bg-white/10': sendTicketType() === type.value,
                                  }}
                                >
                                  <div class="font-semibold text-sm">
                                    {type.label}
                                  </div>
                                  <div class="text-xs text-slate-500">
                                    {type.description}
                                  </div>
                                </button>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!sendPath() || isSending()}
                    class="w-full h-14 text-lg font-bold rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Show when={isSending()} fallback={<><Send class="mr-2 h-5 w-5 inline-block" /> Share File</>}>
                      <Loader2 class="mr-2 h-5 w-5 animate-spin inline-block" /> Generating Ticket...
                    </Show>
                  </button>

                  {/* Ticket Display */}
                  <Show when={sendTicket()}>
                    <div
                      class="p-4 sm:p-6 glass-card rounded-2xl space-y-4 border-primary/20 ring-1 ring-primary/20"
                    >
                      <div class="flex items-center justify-between">
                        <label
                          class="text-xs font-bold uppercase tracking-widest text-primary"
                        >
                          Shareable Ticket
                        </label>
                        <Share2
                          class="w-4 h-4 text-primary opacity-50 cursor-pointer hover:opacity-100"
                          onClick={() => shareText(sendTicket())}
                        />
                      </div>

                      {/* QR Code Display */}
                      <Show when={sendTicketQrCode()}>
                        <div class="flex justify-center p-4 bg-white rounded-xl">
                          <img
                            src={sendTicketQrCode()}
                            alt="Ticket QR Code"
                            class="w-48 h-48 object-contain"
                          />
                        </div>
                      </Show>

                      <div class="p-4 bg-black/5 dark:bg-white/5 rounded-xl break-all text-sm text-black dark:text-white font-mono leading-relaxed border border-white/5">
                        {sendTicket()}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(sendTicket())}
                        class="w-full h-12 rounded-xl font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
                      >
                        <Copy class="w-4 h-4 mr-2 inline-block" />
                        Copy Ticket
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Receive Tab */}
              <Show when={activeTab() === 'receive'}>
                <div class="space-y-6">
                  <div class="space-y-3">
                    <label
                      for="receive-ticket"
                      class="text-sm font-semibold opacity-70 ml-1"
                    >
                      Universal Ticket
                    </label>
                    <div class="flex gap-2">
                      <div class="relative flex-1">
                        <input
                          id="receive-ticket"
                          value={receiveTicket()}
                          onInput={(e) => setReceiveTicket(e.currentTarget.value)}
                          placeholder="Paste ticket or scan QR code..."
                          disabled={isReceiving()}
                          class="h-14 rounded-2xl pl-12 glass shadow-none border-white/10 focus:ring-primary/40 focus:border-primary/40 w-full disabled:opacity-50"
                        />
                        <Share2
                          class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 opacity-40"
                        />
                      </div>
                      <Show when={isMobile()}>
                        <button
                          type="button"
                          onClick={handleScanBarcode}
                          disabled={isReceiving()}
                          class="h-14 w-14 rounded-2xl p-0 flex-shrink-0 bg-secondary hover:bg-secondary/80 text-secondary-foreground disabled:opacity-50 transition-colors"
                          title="Scan QR Code"
                        >
                          <Scan class="h-5 w-5 m-auto" />
                        </button>
                      </Show>
                    </div>
                  </div>

                  <div class="space-y-3">
                    <label
                      for="output-dir"
                      class="text-sm font-semibold opacity-70 ml-1"
                    >
                      Destination Folder (Optional)
                    </label>
                    <div class="flex gap-2">
                      <input
                        id="output-dir"
                        value={receiveOutputDir()}
                        onInput={(e) => handleSetReceiveOutputDir(e.currentTarget.value)}
                        placeholder="Default downloads folder"
                        disabled={isReceiving()}
                        class="h-14 rounded-2xl glass shadow-none border-white/10 w-full px-4 disabled:opacity-50"
                        readOnly
                      />
                      <button
                        type="button"
                        onClick={selectOutputDirectory}
                        disabled={isReceiving()}
                        class="h-14 w-14 rounded-2xl p-0 flex-shrink-0 bg-secondary hover:bg-secondary/80 text-secondary-foreground disabled:opacity-50 transition-colors"
                      >
                        <FolderOpen class="h-5 w-5 m-auto" />
                      </button>
                    </div>
                  </div>

                  <div class="relative group">
                    <button
                      type="button"
                      onClick={() => currentReceivingId() ? handleCancelReceive() : handleReceive()}
                      disabled={!receiveTicket() || (isReceiving() && !currentReceivingId())}
                      class="relative w-full h-14 text-lg font-bold rounded-2xl overflow-hidden transition-all disabled:opacity-50 disabled:cursor-notallowed text-white"
                      classList={{
                        'bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700': !!currentReceivingId(),
                        'bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20': !currentReceivingId()
                      }}
                    >
                      <Show when={currentReceivingId()}
                        fallback={
                          <>
                            <Show when={isReceiving()} fallback={<><Download class="mr-2 h-5 w-5 inline-block" />Connect & Receive</>}>
                              <Loader2 class="mr-2 h-5 w-5 animate-spin inline-block" />Connecting...
                            </Show>
                          </>
                        }
                      >
                        <span class="relative z-10 group-hover:opacity-0 transition-opacity">
                          {Math.round(receiveProgress())}%
                        </span>
                        <div class="absolute inset-0 flex items-center justify-center bg-red-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20">
                          <span class="flex items-center"> Click to Cancel </span>
                        </div>
                      </Show>
                    </button>
                  </div>
                </div>
              </Show>
            </div>
          </div>

          {/* Transfers List */}
          <Show when={transfers().length > 0} fallback={
            <div class="text-center py-12 space-y-4">
              <div class="w-20 h-20 bg-slate-100 dark:bg-slate-800/50 rounded-full flex items-center justify-center mx-auto opacity-20">
                <Share2 class="w-8 h-8 text-slate-900 dark:text-slate-100" />
              </div>
              <div class="space-y-1">
                <p class="text-slate-500 dark:text-slate-400 font-semibold">Ready for departure</p>
                <p class="text-xs text-slate-400 dark:text-slate-500">
                  Your transfer activity will appear here
                </p>
              </div>
            </div>
          }>
            <div class="space-y-4">
              <div class="flex items-center justify-between px-2">
                <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center">
                  Recent Activity
                  <span class="ml-2 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                    {transfers().length}
                  </span>
                </h2>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadTransfers}
                    class="text-xs font-semibold text-primary hover:underline flex items-center"
                  >
                    <RefreshCw class="w-3 h-3 mr-1" />
                    Sync
                  </button>
                  <Show when={transfers().length > 0}>
                    <button
                      type="button"
                      onClick={handleClearTransfers}
                      class="text-xs font-semibold text-red-500 hover:text-red-600 hover:underline flex items-center"
                    >
                      <Trash2 class="w-3 h-3 mr-1" />
                      Clear
                    </button>
                  </Show>
                </div>
              </div>

              <div class="space-y-3">
                <For each={transfers()}>
                  {(transfer) => {
                    const status = getTransferStatus(transfer.status);
                    const Icon = getTransferFileIcon(transfer);
                    const progress = () => progressData()[transfer.id];
                    const meta = () => metadataCache()[transfer.id];

                    return (
                      <div class="glass-card group p-4 sm:p-5 rounded-2xl hover:scale-[1.01] transition-all duration-300">
                        <div class="flex items-start gap-4">
                          <div
                            class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                            classList={{
                              'bg-blue-500/10 text-blue-500': transfer.transfer_type === 'send',
                              'bg-green-500/10 text-green-500': transfer.transfer_type === 'receive'
                            }}
                          >
                            <Icon class="w-6 h-6" />
                          </div>

                          <div class="flex-1 min-w-0 space-y-1">
                            <div class="flex items-center justify-between">
                              <h4
                                class="font-bold truncate pr-4 text-slate-900 dark:text-slate-100"
                                classList={{
                                  'cursor-pointer hover:text-green-600 dark:hover:text-green-400 hover:underline':
                                    transfer.transfer_type === 'receive' && transfer.status.includes('complete'),
                                }}
                                onClick={() => handleOpenFile(transfer)}
                                onKeyPress={(e) => e.key === 'Enter' && handleOpenFile(transfer)}
                                role="button"
                                tabindex="0"
                                title={
                                  transfer.transfer_type === 'receive' && transfer.status.includes('complete')
                                  ? 'Click to open file'
                                  : ''
                                }
                              >
                                {getTransferDisplayName(transfer)}
                              </h4>
                              <span
                                class="text-[10px] font-black uppercase tracking-tighter px-2 py-0.5 rounded-md"
                                classList={{
                                  'bg-blue-500/20 text-blue-500': transfer.transfer_type === 'send',
                                  'bg-green-500/20 text-green-500': transfer.transfer_type === 'receive',
                                }}
                              >
                                {transfer.transfer_type}
                              </span>
                            </div>
                            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
                              <div class="flex items-center gap-1" classList={{ [status.color]: true }}>
                                <span classList={{ 'animate-spin': status.pulse }} style={{ display: 'inline-flex' }}>
                                  <Switch fallback={<RefreshCw class="w-3 h-3" />}>
                                    <Match when={status.icon === 'Check'}><Check class="w-3 h-3" /></Match>
                                    <Match when={status.icon === 'X'}><X class="w-3 h-3" /></Match>
                                    <Match when={status.icon === 'Share2'}><Share2 class="w-3 h-3" /></Match>
                                    <Match when={status.icon === 'Download'}><Download class="w-3 h-3" /></Match>
                                  </Switch>
                                </span>
                                {status.label}
                              </div>
                              <span class="opacity-20 hidden sm:inline">•</span>
                              <div class="flex items-center gap-1">
                                <Monitor class="w-3 h-3 opacity-50" />
                                {formatDate(transfer.created_at)}
                              </div>
                            </div>

                            {/* Progress Section */}
                            <Show when={progress() || meta()}>
                              <div class="mt-4 pt-4 border-t border-white/5 space-y-2">
                                {/* Metadata Display */}
                                <Show when={meta()}>
                                  <div class="space-y-2 p-3 bg-slate-100 dark:bg-slate-800/50 rounded-xl">
                                    <div class="flex items-center gap-2 text-xs font-bold text-primary">
                                      <FileText class="w-3 h-3" />
                                      Transfer Information
                                    </div>
                                    <div class="space-y-1 text-xs">
                                      <div class="flex justify-between">
                                        <span class="opacity-60">Files:</span>
                                        <span class="font-mono font-semibold">{meta().file_count || 0}</span>
                                      </div>
                                      <div class="flex justify-between">
                                        <span class="opacity-60">Size:</span>
                                        <span class="font-mono font-semibold">{formatFileSize(meta().total_size || 0)}</span>
                                      </div>
                                      <Show when={(meta().names?.length || 0) > 0}>
                                        <div class="pt-2 border-t border-white/5">
                                          <div class="opacity-60 mb-1">Contents:</div>
                                          <div class="space-y-0.5 pl-2">
                                            <For each={(meta().names || []).slice(0, 3)}>
                                              {(name: string) => <div class="text-[10px] font-mono opacity-80 truncate">{name}</div>}
                                            </For>
                                            <Show when={(meta().names?.length || 0) > 3}>
                                              <div class="text-[10px] opacity-50">
                                                +{(meta().names?.length || 0) - 3} more...
                                              </div>
                                            </Show>
                                          </div>
                                        </div>
                                      </Show>
                                    </div>
                                  </div>
                                </Show>
                                {/* Download Progress */}
                                <Show when={progress()?.progress?.type === 'downloading'}>
                                  <div>
                                    <div class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide opacity-50">
                                      <span>{progress()?.name || "Transferring..."}</span>
                                      <span>{Math.round(getProgressValue(progress() || {}))}%</span>
                                    </div>
                                    <div class="h-1.5 bg-slate-200 dark:bg-slate-700 w-full rounded-full">
                                      <div
                                        class="bg-primary h-full rounded-full transition-all duration-300"
                                        style={{ width: `${getProgressValue(progress() || {})}%` }}
                                      ></div>
                                    </div>
                                    <div class="text-[10px] text-right font-mono opacity-50">
                                      {formatFileSize(progress()?.progress.offset || 0)} / {formatFileSize(progress()?.progress.total || 0)}
                                    </div>
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          </div>
                          <div class="flex items-start self-stretch">
                            <Show when={!transfer.status.includes('complete') && !transfer.status.includes('error') && !transfer.status.includes('cancel')}>
                              <button
                                type="button"
                                onClick={() => handleCancel(transfer.id)}
                                class="p-2 hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors group/cancel"
                                title="Abort Transfer"
                              >
                                <X class="w-4 h-4" />
                              </button>
                            </Show>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </main>
    </>
  );
}

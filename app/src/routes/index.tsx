import {
  createSignal,
  onMount,
  onCleanup,
  createEffect,
  For,
  Show,
  Switch,
  Match,
} from "solid-js";
import {
  send_file,
  receive_file,
  send_text,
  receive_text,
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
  Monitor,
  Trash2,
  Sparkles,
  Shield,
  Zap,
  MessageSquare,
  Clipboard,
  Scan,
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

export default function MainPage() {
  // Platform detection
  const [isMobile, setIsMobile] = createSignal(false);
  const [isMobileMediaQuery, setIsMobileMediaQuery] = createSignal(false);

  // Initialization state
  const [isInitializing, setIsInitializing] = createSignal(true);

  // Theme state
  const [theme, setTheme] = createSignal<Theme>("system");

  // Desktop-specific state
  const [activeTab, setActiveTab] = createSignal<"send" | "receive" | "text">(
    "send",
  );
  const [sendPath, setSendPath] = createSignal("");
  const [sendTicketType, setSendTicketType] = createSignal(
    "relay_and_addresses",
  );
  const [sendTicket, setSendTicket] = createSignal("");
  const [sendTicketQrCode, setSendTicketQrCode] = createSignal("");
  const [isSending, setIsSending] = createSignal(false);
  const [showTicketPopover, setShowTicketPopover] = createSignal(false);
  const [receiveTicket, setReceiveTicket] = createSignal("");
  const [receiveOutputDir, setReceiveOutputDir] = createSignal("");
  const [isReceiving, setIsReceiving] = createSignal(false);
  const [currentReceivingId, setCurrentReceivingId] = createSignal<
    string | null
  >(null);

  // Text send state
  const [sendTextContent, setSendTextContent] = createSignal("");
  const [textSendTicket, setTextSendTicket] = createSignal("");
  const [textSendTicketQrCode, setTextSendTicketQrCode] = createSignal("");
  const [isSendingText, setIsSendingText] = createSignal(false);

  // Text receive state
  const [receiveTextTicket, setReceiveTextTicket] = createSignal("");
  const [receivedText, setReceivedText] = createSignal("");
  const [receivedTextFilename, setReceivedTextFilename] = createSignal("");
  const [isReceivingText, setIsReceivingText] = createSignal(false);

  // Mobile-specific state
  const [mobileTab, setMobileTab] = createSignal<MobileTab>("home");
  const [currentSendingId, setCurrentSendingId] = createSignal<string | null>(
    null,
  );
  const [receiveProgress, setReceiveProgress] = createSignal(0);

  // Transfers state
  const [transfers, setTransfers] = createSignal<Transfer[]>([]);

  // Progress state
  const [progressData, setProgressData] = createSignal<
    Record<string, ProgressData>
  >({});
  const [metadataCache, setMetadataCache] = createSignal<Record<string, any>>(
    {},
  );

  // Interaction state (desktop)
  const [mousePos, setMousePos] = createSignal({ x: 0, y: 0 });

  // Computed: receive progress
  const receiveProgressPercent = () => {
    if (!currentReceivingId()) {
      return 0;
    }
    const data = progressData()[currentReceivingId()!];
    if (!data?.progress) {
      return 0;
    }

    if (data.progress.type === "downloading") {
      return (data.progress.offset / data.progress.total) * 100;
    }

    if (data.progress.type === "completed") {
      return 100;
    }

    return 0;
  };

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

  // File picker functions
  async function selectFile() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
      });
      if (selected && typeof selected === "string") {
        setSendPath(selected);
        setSendTicket("");
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
        console.log("output_dir=", result);
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
      setSendTicketQrCode(
        await QRCode.toDataURL(result, {
          errorCorrectionLevel: "H",
          width: 300,
        }),
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

  // Text send/receive handlers
  async function handleSendText() {
    if (!sendTextContent()) {
      return;
    }

    setIsSendingText(true);
    setTextSendTicket("");
    setTextSendTicketQrCode("");

    try {
      const result = await send_text({
        text: sendTextContent(),
        ticket_type: sendTicketType(),
      });
      setTextSendTicket(result);
      setTextSendTicketQrCode(
        await QRCode.toDataURL(result, {
          errorCorrectionLevel: "H",
          width: 300,
        }),
      );
    } catch (e) {
      console.error("Send text failed:", e);
      toast.error(`Send text failed: ${e}`);
    } finally {
      setIsSendingText(false);
    }
  }

  async function handleReceiveText() {
    if (!receiveTextTicket()) {
      return;
    }

    setIsReceivingText(true);
    setReceivedText("");
    setReceivedTextFilename("");

    try {
      const result = await receive_text({
        ticket: receiveTextTicket(),
      });
      setReceivedText(result.text);
      setReceivedTextFilename(result.filename);
      setReceiveTextTicket("");
    } catch (e) {
      console.error("Receive text failed:", e);
      toast.error(`Receive text failed: ${e}`);
    } finally {
      setIsReceivingText(false);
    }
  }

  async function copyReceivedText() {
    await navigator.clipboard.writeText(receivedText());
    toast.success("Text copied to clipboard");
  }

  async function handleCancelReceive() {
    if (currentReceivingId()) {
      await handleCancel(currentReceivingId()!);
      setCurrentReceivingId(null);
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
    if (transfer.transfer_type === "receive" && meta?.names?.length > 0) {
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
    if (transfer.transfer_type === "receive" && meta?.names?.length > 0) {
      const iconName = getFileIcon(meta.names[0]);
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

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Ticket copied to clipboard");
  }

  const shareText = (text: string) => {
    if (navigator.share) {
      navigator
        .share({
          title: "Sendme Ticket",
          text: text,
        })
        .then(() => console.log("Successful share"))
        .catch((error) => console.log("Error sharing", error));
    } else {
      copyToClipboard(text);
    }
  };

  // Mobile-specific handlers
  async function handleScanBarcode() {
    try {
      let permissionStatus = await checkPermissions();
      if (permissionStatus !== "granted") {
        permissionStatus = await requestPermissions();
      }

      if (permissionStatus !== "granted") {
        toast.error("Camera permission is required to scan QR codes");
        return;
      }

      const result = await scan({ formats: [Format.QRCode] });
      if (result && result.content) {
        setReceiveTicket(result.content);
      }
    } catch (e) {
      console.error("Scan error:", e);
      toast.error(`Scan failed: ${e}`);
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

  const handleSetReceiveOutputDir = (value: string) => {
    setReceiveOutputDir(value);
    localStorage.setItem("receive-output-dir", value);
  };

  // QR code URL for mobile
  const qrCodeUrl = () => {
    if (!sendTicket()) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(sendTicket()!)}`;
  };

  // Initialize
  onMount(async () => {
    // Detect platform from Tauri
    try {
      const currentPlatform = await platform();
      setIsMobile(currentPlatform === "android" || currentPlatform === "ios");
    } catch (e) {
      console.error("Platform detection failed:", e);
    }

    // Media query fallback for web
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    setIsMobileMediaQuery(mediaQuery.matches);

    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsMobileMediaQuery(e.matches);
    };
    mediaQuery.addEventListener("change", handleMediaChange);

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

    // Desktop: track mouse for dynamic background
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

      // Mobile: update progress
      if (isMobile() && event.payload.event_type === "download") {
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

    // Cleanup on unmount
    onCleanup(() => {
      unlisten();
      window.removeEventListener("mousemove", handleMouseMove);
      mediaQuery.removeEventListener("change", handleMediaChange);
    });

    // Mark initialization as complete
    setIsInitializing(false);
  });

  // Determine if we should show mobile UI
  const showMobileUI = () => isMobile() || isMobileMediaQuery();

  // ==================== DESKTOP UI ====================
  const DesktopUI = () => (
    <>
      {/* Dynamic Background */}
      <div class="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <Motion.div
          animate={{
            x: mousePos().x * 0.03,
            y: mousePos().y * 0.03,
          }}
          class="absolute top-[-10%] left-[-10%] h-[50%] w-[50%] rounded-full bg-purple-600/10 blur-[120px]"
        />
        <Motion.div
          animate={{
            x: mousePos().x * -0.02,
            y: mousePos().y * -0.02,
          }}
          class="absolute right-[-10%] bottom-[-10%] h-[60%] w-[60%] rounded-full bg-indigo-600/10 blur-[120px]"
        />
        <div class="absolute top-1/2 left-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(18,14,38,0.4)_100%)]" />
      </div>

      <main class="relative z-10 flex min-h-screen flex-col items-center px-4 py-8">
        <div class="w-full max-w-2xl space-y-10">
          {/* Header */}
          <header class="flex items-center justify-between">
            <div class="group flex items-center gap-4">
              <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-purple-500 to-indigo-600 shadow-xl shadow-purple-500/20 transition-all group-hover:shadow-purple-500/40">
                <Sparkles size={24} class="dark:text-white" />
              </div>
              <div>
                <h1 class="bg-linear-to-r from-gray-900 to-gray-600 dark:from-white dark:to-white/60 bg-clip-text text-2xl font-bold tracking-tight text-transparent dark:text-transparent">
                  Sendme
                </h1>
                <p class="text-[10px] font-bold tracking-[0.2em] text-gray-500 dark:text-white/30 uppercase">
                  Secure P2P Node
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                class="touch-button rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 p-2.5 text-gray-600 dark:text-white/50 transition-all hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white active:scale-95"
                title={`Current theme: ${theme()}`}
              >
                <Switch>
                  <Match when={theme() === "light"}>
                    <Sun class="h-5 w-5" />
                  </Match>
                  <Match when={theme() === "dark"}>
                    <Moon class="h-5 w-5" />
                  </Match>
                  <Match when={theme() === "system"}>
                    <Monitor class="h-5 w-5" />
                  </Match>
                </Switch>
              </button>
            </div>
          </header>

          {/* Main Card */}
          <Presence>
            <Motion.div
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              class="glass-liquid glass-frost relative rounded-3xl border border-white/10 shadow-2xl"
            >
              <div class="p-8">
                {/* Tabs */}
                <div class="relative mb-8 flex gap-1 overflow-hidden p-1.5">
                  <Motion.div
                    animate={{
                      left:
                        activeTab() === "send"
                          ? "2px"
                          : activeTab() === "receive"
                            ? "calc(33.33% + 1px)"
                            : "calc(66.66% + 1px)",
                      width: "calc(33.33% - 4px)",
                    }}
                    transition={{ duration: 0.2, easing: "ease-out" }}
                    class="absolute top-1.5 bottom-1.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 shadow-lg shadow-purple-500/20"
                  />
                  <button
                    onClick={() => setActiveTab("send")}
                    class={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-semibold transition-all ${
                      activeTab() === "send"
                        ? "text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80"
                    }`}
                  >
                    <Send size={20} />
                    Send
                  </button>
                  <button
                    onClick={() => setActiveTab("receive")}
                    class={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-semibold transition-all ${
                      activeTab() === "receive"
                        ? "text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80"
                    }`}
                  >
                    <Download size={20} />
                    Receive
                  </button>
                  <button
                    onClick={() => setActiveTab("text")}
                    class={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-semibold transition-all ${
                      activeTab() === "text"
                        ? "text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80"
                    }`}
                  >
                    <MessageSquare size={20} />
                    Text
                  </button>
                </div>

                {/* Content area */}
                <div class="relative">
                  <Switch fallback={null}>
                    <Match when={activeTab() === "send"}>
                      <Motion.div
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, easing: "ease-out" }}
                        class="space-y-6"
                      >
                        <div class="space-y-4">
                          <div
                            class="group relative flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-white/10 bg-white/2 p-12 transition-all hover:border-purple-500/30 hover:bg-white/4"
                            onClick={selectFile}
                          >
                            <div class="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 shadow-lg shadow-purple-500/10 transition-transform group-hover:scale-110">
                              <FolderOpen class="text-purple-400" size={36} />
                            </div>
                            <h3 class="text-xl font-semibold text-gray-900 dark:text-white">
                              {sendPath()
                                ? getDisplayName(sendPath())
                                : "Share a file"}
                            </h3>
                            <p class="mt-2 text-sm text-gray-500 dark:text-white/40">
                              {sendPath()
                                ? "Tap to change file"
                                : "Tap to select a file from your device"}
                            </p>
                          </div>

                          <div class="flex gap-3">
                            <button
                              onClick={selectDirectory}
                              disabled={isSending()}
                              class="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 px-4 py-3 text-sm font-medium text-gray-700 dark:text-white/70 transition-all hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50"
                            >
                              <FolderOpen size={16} />
                              Directory
                            </button>

                            <div class="relative flex-1">
                              <button
                                onClick={() =>
                                  setShowTicketPopover(!showTicketPopover())
                                }
                                disabled={isSending()}
                                class="flex w-full items-center justify-between rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 px-4 py-3 text-sm font-medium text-gray-700 dark:text-white/70 transition-all hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50"
                              >
                                <span class="truncate">
                                  {
                                    ticketTypes.find(
                                      (t) => t.value === sendTicketType(),
                                    )?.label
                                  }
                                </span>
                                <ChevronRight size={14} class="opacity-40" />
                              </button>
                              <Show when={showTicketPopover()}>
                                <div class="glass animate-in fade-in absolute left-0 z-50 mt-1 w-full overflow-hidden rounded-2xl border border-white/10 p-2 shadow-2xl duration-200">
                                  <For each={ticketTypes}>
                                    {(type) => (
                                      <button
                                        onClick={() => {
                                          setSendTicketType(type.value as any);
                                          setShowTicketPopover(false);
                                        }}
                                        class={`w-full rounded-xl px-3 py-2 text-left transition-all ${
                                          sendTicketType() === type.value
                                            ? "bg-purple-100 dark:bg-white/10 text-purple-900 dark:text-white"
                                            : "text-gray-600 dark:text-white/40 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white/60"
                                        }`}
                                      >
                                        <div class="text-xs font-semibold">
                                          {type.label}
                                        </div>
                                        <div class="mt-0.5 text-[10px] opacity-60">
                                          {type.description}
                                        </div>
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
                          class="touch-active flex h-14 min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-linear-to-r from-purple-600 to-indigo-600 font-bold text-gray-900 dark:text-white shadow-xl shadow-purple-500/20 transition-all hover:shadow-purple-500/40 disabled:opacity-50"
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
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              class="space-y-6 border-t border-white/5 pt-6"
                            >
                              <div class="flex flex-col items-center gap-6">
                                <Show when={sendTicketQrCode()}>
                                  <div class="rounded-3xl bg-white p-4 shadow-2xl">
                                    <img
                                      src={sendTicketQrCode()!}
                                      alt="QR"
                                      class="h-48 w-48"
                                    />
                                  </div>
                                </Show>

                                <div class="w-full space-y-3">
                                  <div class="glass-inset flex flex-col gap-2 rounded-2xl p-4">
                                    <label class="text-[10px] font-bold tracking-widest text-gray-500 dark:text-white/30 uppercase">
                                      Transfer Ticket
                                    </label>
                                    <div class="flex items-center gap-3">
                                      <code class="flex-1 truncate rounded-lg bg-purple-500/10 px-3 py-2 font-mono text-sm text-purple-200">
                                        {sendTicket()}
                                      </code>
                                      <button
                                        onClick={() =>
                                          copyToClipboard(sendTicket()!)
                                        }
                                        class="rounded-xl bg-gray-100 dark:bg-white/5 p-2.5 text-gray-600 dark:text-white/60 transition-colors hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white"
                                      >
                                        <Copy size={18} />
                                      </button>
                                    </div>
                                  </div>

                                  <Show when={isMobile()}>
                                    <button
                                      onClick={() => shareText(sendTicket()!)}
                                      class="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-100 dark:bg-white/5 py-4 font-semibold text-gray-900 dark:text-white transition-all hover:bg-gray-200 dark:hover:bg-white/10"
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
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, easing: "ease-out" }}
                        class="space-y-6"
                      >
                        <div class="space-y-4">
                          <div class="space-y-2">
                            <label class="ml-1 text-xs font-bold tracking-widest text-gray-500 dark:text-white/30 uppercase">
                              Universal Ticket
                            </label>
                            <div class="flex gap-2">
                              <div class="relative flex-1">
                                <input
                                  value={receiveTicket()}
                                  onInput={(e) =>
                                    setReceiveTicket(e.currentTarget.value)
                                  }
                                  placeholder="Paste ticket code..."
                                  class="h-14 w-full rounded-2xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 pr-4 pl-12 font-mono text-sm text-gray-900 dark:text-white transition-all placeholder:text-gray-400 dark:placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none"
                                />
                                <Shield
                                  class="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400 dark:text-white/20"
                                  size={20}
                                />
                              </div>
                            </div>
                          </div>

                          <div class="space-y-2">
                            <label class="ml-1 text-xs font-bold tracking-widest text-gray-500 dark:text-white/30 uppercase">
                              Destination
                            </label>
                            <div class="flex gap-2">
                              <div class="relative flex-1">
                                <input
                                  readOnly
                                  value={
                                    receiveOutputDir() || "Default Downloads"
                                  }
                                  class="h-14 w-full rounded-2xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 pr-4 pl-12 text-sm text-gray-500 dark:text-white/50 focus:outline-none"
                                />
                                <FolderOpen
                                  class="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400 dark:text-white/20"
                                  size={20}
                                />
                              </div>
                              <button
                                onClick={selectOutputDirectory}
                                class="flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-white/60 transition-all hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white"
                              >
                                <ChevronRight size={20} />
                              </button>
                            </div>
                          </div>
                        </div>

                        <div class="group relative">
                          <Motion.button
                            hover={{ scale: 1.02 }}
                            press={{ scale: 0.98 }}
                            onClick={() =>
                              currentReceivingId()
                                ? handleCancelReceive()
                                : handleReceive()
                            }
                            disabled={
                              !receiveTicket() ||
                              (isReceiving() && !currentReceivingId())
                            }
                            class={`touch-active flex h-14 min-h-14 w-full items-center justify-center gap-2 rounded-2xl font-bold shadow-xl transition-all ${
                              currentReceivingId()
                                ? "border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20"
                                : "bg-linear-to-r from-indigo-600 to-purple-600 text-white shadow-indigo-500/20 hover:shadow-indigo-500/40"
                            }`}
                          >
                            <Show
                              when={currentReceivingId()}
                              fallback={
                                <>
                                  {isReceiving() ? (
                                    <Loader2 class="animate-spin" size={20} />
                                  ) : (
                                    <Download size={20} />
                                  )}
                                  {isReceiving()
                                    ? "Connecting..."
                                    : "Connect & Receive"}
                                </>
                              }
                            >
                              <span class="group-hover:hidden">
                                {Math.round(receiveProgressPercent())}% Receiving...
                              </span>
                              <span class="hidden items-center gap-2 group-hover:flex">
                                <X size={18} /> Cancel Transfer
                              </span>
                            </Show>
                          </Motion.button>
                        </div>
                      </Motion.div>
                    </Match>

                    <Match when={activeTab() === "text"}>
                      <Motion.div
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, easing: "ease-out" }}
                        class="space-y-6"
                      >
                        {/* Send Text Section */}
                        <div class="space-y-4">
                          <h3 class="text-sm font-semibold text-gray-700 dark:text-white/80">
                            Send Text
                          </h3>
                          <div class="space-y-2">
                            <textarea
                              value={sendTextContent()}
                              onInput={(e) =>
                                setSendTextContent(e.currentTarget.value)
                              }
                              placeholder="Enter text to send..."
                              class="h-32 w-full resize-none rounded-2xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 p-4 font-mono text-sm text-gray-900 dark:text-white transition-all placeholder:text-gray-400 dark:placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none"
                            />
                          </div>

                          <Motion.button
                            hover={{ scale: 1.02 }}
                            press={{ scale: 0.98 }}
                            onClick={handleSendText}
                            disabled={!sendTextContent() || isSendingText()}
                            class="touch-active flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-purple-600 to-indigo-600 font-semibold text-white transition-all hover:shadow-purple-500/20 disabled:opacity-50"
                          >
                            {isSendingText() ? (
                              <Loader2 class="animate-spin" size={18} />
                            ) : (
                              <>
                                <Zap size={18} />
                                Generate Text Ticket
                              </>
                            )}
                          </Motion.button>

                          <Presence>
                            <Show when={textSendTicket()}>
                              <Motion.div
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                class="space-y-4 border-t border-white/5 pt-4"
                              >
                                <Show when={textSendTicketQrCode()}>
                                  <div class="flex justify-center">
                                    <div class="rounded-2xl bg-white p-3">
                                      <img
                                        src={textSendTicketQrCode()!}
                                        alt="QR"
                                        class="h-32 w-32"
                                      />
                                    </div>
                                  </div>
                                </Show>

                                <div class="glass-inset flex flex-col gap-2 rounded-2xl p-4">
                                  <label class="text-[10px] font-bold tracking-widest text-gray-500 dark:text-white/30 uppercase">
                                    Text Ticket
                                  </label>
                                  <div class="flex items-center gap-3">
                                    <code class="flex-1 truncate rounded-lg bg-purple-500/10 px-3 py-2 font-mono text-xs text-purple-200">
                                      {textSendTicket()}
                                    </code>
                                    <button
                                      onClick={() =>
                                        copyToClipboard(textSendTicket()!)
                                      }
                                      class="rounded-xl bg-gray-100 dark:bg-white/5 p-2.5 text-gray-600 dark:text-white/60 transition-colors hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white"
                                    >
                                      <Copy size={16} />
                                    </button>
                                  </div>
                                </div>

                                <Show when={isMobile()}>
                                  <button
                                    onClick={() =>
                                      shareText(textSendTicket()!)
                                    }
                                    class="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/5 py-3 font-semibold text-gray-900 dark:text-white transition-all hover:bg-gray-200 dark:hover:bg-white/10"
                                  >
                                    <Share2 size={16} />
                                    Share
                                  </button>
                                </Show>
                              </Motion.div>
                            </Show>
                          </Presence>
                        </div>

                        {/* Divider */}
                        <div class="flex items-center gap-4">
                          <div class="h-px flex-1 bg-white/10" />
                          <span class="text-xs text-gray-500 dark:text-white/30">OR</span>
                          <div class="h-px flex-1 bg-white/10" />
                        </div>

                        {/* Receive Text Section */}
                        <div class="space-y-4">
                          <h3 class="text-sm font-semibold text-gray-700 dark:text-white/80">
                            Receive Text
                          </h3>
                          <div class="space-y-2">
                            <input
                              value={receiveTextTicket()}
                              onInput={(e) =>
                                setReceiveTextTicket(e.currentTarget.value)
                              }
                              placeholder="Paste ticket code..."
                              class="h-14 w-full rounded-2xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 px-4 font-mono text-sm text-gray-900 dark:text-white transition-all placeholder:text-gray-400 dark:placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none"
                            />
                          </div>

                          <Motion.button
                            hover={{ scale: 1.02 }}
                            press={{ scale: 0.98 }}
                            onClick={handleReceiveText}
                            disabled={
                              !receiveTextTicket() || isReceivingText()
                            }
                            class="touch-active flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-indigo-600 to-purple-600 font-semibold text-white transition-all hover:shadow-indigo-500/20 disabled:opacity-50"
                          >
                            {isReceivingText() ? (
                              <Loader2 class="animate-spin" size={18} />
                            ) : (
                              <>
                                <Download size={18} />
                                Receive Text
                              </>
                            )}
                          </Motion.button>

                          <Presence>
                            <Show when={receivedText()}>
                              <Motion.div
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                class="space-y-4 border-t border-white/5 pt-4"
                              >
                                <div class="glass-inset flex flex-col gap-2 rounded-2xl p-4">
                                  <label class="text-[10px] font-bold tracking-widest text-gray-500 dark:text-white/30 uppercase">
                                    Received: {receivedTextFilename()}
                                  </label>
                                  <div class="max-h-48 overflow-y-auto rounded-lg bg-white/5 p-3">
                                    <pre class="font-mono text-sm break-words whitespace-pre-wrap text-white/80">
                                      {receivedText()}
                                    </pre>
                                  </div>
                                </div>

                                <button
                                  onClick={copyReceivedText}
                                  class="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/5 py-3 font-semibold text-gray-900 dark:text-white transition-all hover:bg-gray-200 dark:hover:bg-white/10"
                                >
                                  <Clipboard size={16} />
                                  Copy to Clipboard
                                </button>
                              </Motion.div>
                            </Show>
                          </Presence>
                        </div>
                      </Motion.div>
                    </Match>
                  </Switch>
                </div>
              </div>
            </Motion.div>
          </Presence>

          {/* Activity List */}
          <Show when={!isInitializing()}>
            <section class="space-y-6">
              <div class="flex items-center justify-between px-2">
                <h2 class="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
                  Activity
                  <span class="rounded-lg bg-gray-100 dark:bg-white/5 px-2 py-0.5 text-xs text-gray-600 dark:text-white/40">
                    {transfers().length}
                  </span>
                </h2>
                <div class="flex items-center gap-4">
                  <button
                    onClick={loadTransfers}
                    class="flex items-center gap-2 text-xs font-bold tracking-wider text-gray-500 dark:text-white/30 uppercase transition-colors hover:text-purple-400"
                  >
                    <RefreshCw size={14} /> Sync
                  </button>
                  <Show when={transfers().length > 0}>
                    <button
                      onClick={handleClearTransfers}
                      class="flex items-center gap-2 text-xs font-bold tracking-wider text-red-400/50 uppercase transition-colors hover:text-red-400"
                    >
                      <Trash2 size={14} /> Clear
                    </button>
                  </Show>
                </div>
              </div>

              <Presence>
                <Show
                  when={transfers().length > 0}
                  fallback={
                    <Motion.div
                      animate={{ opacity: 1 }}
                      class="glass flex flex-col items-center justify-center space-y-4 rounded-3xl border border-white/5 p-12 text-center"
                    >
                      <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-white/10">
                        <Share2 size={32} />
                      </div>
                      <div>
                        <p class="font-medium text-gray-900 dark:text-white">No activity yet</p>
                        <p class="text-sm text-gray-500 dark:text-white/20">
                          Your shared and received files will appear here
                        </p>
                      </div>
                    </Motion.div>
                  }
                >
                  <div class="grid grid-cols-1 gap-4">
                    <For each={transfers()}>
                      {(transfer) => {
                        const status = getTransferStatus(transfer.status);
                        const Icon = getTransferFileIcon(transfer);
                        const progress = () => progressData()[transfer.id];
                        const meta = () => metadataCache()[transfer.id];

                        return (
                          <Motion.div
                            animate={{ opacity: 1 }}
                            class="glass group rounded-2xl border border-white/5 p-4 transition-all hover:border-white/10"
                          >
                            <div class="flex items-center gap-4">
                              <div
                                class={`flex h-12 w-12 items-center justify-center rounded-xl ${
                                  transfer.transfer_type === "send"
                                    ? "bg-purple-500/10 text-purple-400"
                                    : "bg-indigo-500/10 text-indigo-400"
                                }`}
                              >
                                <Icon size={24} />
                              </div>

                              <div class="min-w-0 flex-1">
                                <div class="flex items-center justify-between gap-4">
                                  <h4
                                    onClick={() => handleOpenFile(transfer)}
                                    class={`truncate font-semibold text-gray-900 dark:text-white ${
                                      transfer.transfer_type === "receive" &&
                                      transfer.status.includes("complete")
                                        ? "cursor-pointer hover:text-purple-400 hover:underline"
                                        : ""
                                    }`}
                                  >
                                    {getTransferDisplayName(transfer)}
                                  </h4>
                                  <span
                                    class={`rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
                                      transfer.transfer_type === "send"
                                        ? "bg-purple-500/20 text-purple-300"
                                        : "bg-indigo-500/20 text-indigo-300"
                                    }`}
                                  >
                                    {transfer.transfer_type}
                                  </span>
                                </div>

                                <div class="mt-1 flex items-center gap-3 underline-offset-4">
                                  <div
                                    class={`flex items-center gap-1 text-[11px] font-medium ${status.color}`}
                                  >
                                    <div
                                      class={
                                        status.pulse ? "animate-pulse" : ""
                                      }
                                    >
                                      <Switch>
                                        <Match when={status.icon === "Check"}>
                                          <Check size={12} />
                                        </Match>
                                        <Match when={status.icon === "X"}>
                                          <X size={12} />
                                        </Match>
                                        <Match when={status.icon === "Share2"}>
                                          <Share2 size={12} />
                                        </Match>
                                        <Match
                                          when={status.icon === "Download"}
                                        >
                                          <Download size={12} />
                                        </Match>
                                        <Match when={true}>
                                          <RefreshCw
                                            size={12}
                                            class="animate-spin"
                                          />
                                        </Match>
                                      </Switch>
                                    </div>
                                    {status.label}
                                  </div>
                                  <span class="text-gray-400 dark:text-white/10">•</span>
                                  <span class="text-[11px] text-gray-500 dark:text-white/30">
                                    {formatDate(transfer.created_at)}
                                  </span>
                                </div>

                                <Show when={progress() || meta()}>
                                  <div class="mt-4 space-y-3 border-t border-white/5 pt-4">
                                    <Show when={meta()}>
                                      <div class="flex gap-4 text-[10px] text-white/40">
                                        <span class="flex items-center gap-1">
                                          <FileText size={10} />{" "}
                                          {meta()?.file_count || 0} files
                                        </span>
                                        <span>
                                          {formatFileSize(
                                            meta()?.total_size || 0,
                                          )}
                                        </span>
                                      </div>
                                    </Show>

                                    <Show
                                      when={
                                        progress()?.progress?.type ===
                                        "downloading"
                                      }
                                    >
                                      <div class="space-y-1.5">
                                        <div class="flex justify-between text-[10px] text-white/40">
                                          <span class="truncate pr-4">
                                            {progress()?.name}
                                          </span>
                                          <span>
                                            {Math.round(
                                              getProgressValue(progress() || {}),
                                            )}
                                            %
                                          </span>
                                        </div>
                                        <div class="h-1 overflow-hidden rounded-full bg-white/5">
                                          <div
                                            class="h-full bg-linear-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                                            style={{
                                              width: `${getProgressValue(progress() || {})}%`,
                                            }}
                                          />
                                        </div>
                                      </div>
                                    </Show>
                                  </div>
                                </Show>
                              </div>

                              <Show
                                when={
                                  !transfer.status.includes("complete") &&
                                  !transfer.status.includes("error") &&
                                  !transfer.status.includes("cancel")
                                }
                              >
                                <button
                                  onClick={() => handleCancel(transfer.id)}
                                  class="p-2 text-white/20 transition-colors hover:text-red-400"
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
          </Show>

          {/* Footer */}
          <Motion.footer
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            class="relative z-10 mt-auto py-12 text-center"
          >
            <div class="mb-4 flex items-center justify-center gap-4">
              <div class="h-px w-8 bg-white/10" />
              <span class="text-[10px] font-bold tracking-[0.2em] text-gray-500 dark:text-white/30 uppercase">
                Secure Protocol
              </span>
              <div class="h-px w-8 bg-white/10" />
            </div>
            <p class="text-sm text-gray-500 dark:text-white/40">
              Powered by{" "}
              <a
                href="https://iroh.computer"
                target="_blank"
                rel="noopener noreferrer"
                class="font-medium text-purple-400/80 underline decoration-purple-500/30 underline-offset-4 transition-colors hover:text-purple-300"
              >
                iroh.computer
              </a>
            </p>
          </Motion.footer>
        </div>
      </main>
    </>
  );

  // ==================== MOBILE UI ====================
  const MobileUI = () => (
    <div class="min-h-screen bg-[#120e26] pb-20">
      <Toaster position="top-center" />

      {/* Header */}
      <header class="glass-liquid sticky top-0 z-40 border-b border-white/5 px-4 py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-purple-500 to-indigo-600">
              <Sparkles size={20} class="dark:text-white" />
            </div>
            <div>
              <h1 class="text-lg font-bold text-gray-900 dark:text-white">Sendme</h1>
              <p class="text-[10px] tracking-wider text-gray-500 dark:text-white/40 uppercase">
                P2P Transfer
              </p>
            </div>
          </div>

          <button
            onClick={toggleTheme}
            class="touch-button rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 p-2.5 text-gray-600 dark:text-white/50 transition-all hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white active:scale-95"
          >
            <Switch>
              <Match when={theme() === "light"}>
                <Sun size={18} />
              </Match>
              <Match when={theme() === "dark"}>
                <Moon size={18} />
              </Match>
              <Match when={theme() === "system"}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
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
          <Show when={mobileTab() === "home"}>
            <Motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              class="space-y-4"
            >
              {/* Send Card */}
              <div class="glass-liquid rounded-2xl border border-white/10 p-4">
                <h2 class="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                  <Send size={18} class="text-purple-400" />
                  Send Files
                </h2>

                {/* File Selection */}
                <div
                  onClick={selectFile}
                  class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/10 bg-white/5 p-4 transition-all hover:border-purple-500/30 active:scale-98"
                >
                  <FolderOpen size={32} class="mb-2 text-gray-500 dark:text-white/40" />
                  <span class="text-sm text-gray-600 dark:text-white/60">
                    {sendPath()
                      ? getDisplayName(sendPath())
                      : "Tap to select file"}
                  </span>
                </div>

                {/* Send Button */}
                <button
                  onClick={handleSend}
                  disabled={!sendPath() || isSending()}
                  class="touch-active mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-purple-600 to-indigo-600 font-semibold text-white transition-all hover:shadow-lg hover:shadow-purple-500/25 disabled:opacity-50"
                >
                  <Show
                    when={isSending()}
                    fallback={
                      <>
                        <Zap size={18} /> Generate Ticket
                      </>
                    }
                  >
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
                      <div class="mb-2 flex items-center justify-between">
                        <span class="text-xs text-gray-500 dark:text-white/50">Ticket</span>
                        <div class="flex gap-2">
                          <button
                            onClick={() => copyToClipboard(sendTicket()!)}
                            class="rounded-lg bg-gray-100 dark:bg-white/5 p-1.5 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                          >
                            <Copy size={14} />
                          </button>
                          <Show when={isMobile()}>
                            <button
                              onClick={() => shareText(sendTicket()!)}
                              class="rounded-lg bg-gray-100 dark:bg-white/5 p-1.5 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                            >
                              <Share2 size={14} />
                            </button>
                          </Show>
                        </div>
                      </div>
                      <p class="font-mono text-xs break-all text-gray-700 dark:text-white/80">
                        {sendTicket()}
                      </p>
                    </div>

                    {/* QR Code */}
                    <Show when={qrCodeUrl()}>
                      <div class="mt-3 flex justify-center">
                        <div class="glass rounded-xl p-2">
                          <img
                            src={qrCodeUrl()}
                            alt="QR Code"
                            class="h-32 w-32 rounded-lg"
                          />
                        </div>
                      </div>
                    </Show>
                  </Motion.div>
                </Show>
              </div>

              {/* Receive Card */}
              <div class="glass-liquid rounded-2xl border border-white/10 p-4">
                <h2 class="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                  <Download size={18} class="text-indigo-400" />
                  Receive Files
                </h2>

                {/* Ticket Input */}
                <input
                  type="text"
                  value={receiveTicket()}
                  onInput={(e) => setReceiveTicket(e.currentTarget.value)}
                  placeholder="Paste ticket here"
                  class="h-12 w-full rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 px-4 pr-12 font-mono text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none"
                />

                {/* Scan Button */}
                <Show when={isMobile()}>
                  <button
                    onClick={handleScanBarcode}
                    class="touch-active mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 text-sm text-gray-600 dark:text-white/60 transition-all hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white"
                  >
                    <Scan size={16} />
                    Scan QR Code
                  </button>
                </Show>

                {/* Output Directory */}
                <div class="mt-3 flex gap-2">
                  <div class="flex h-10 flex-1 items-center rounded-xl border border-white/5 bg-white/5 px-3">
                    <span class="truncate text-xs text-gray-500 dark:text-white/50">
                      {receiveOutputDir() || "Default location"}
                    </span>
                  </div>
                  <button
                    onClick={selectOutputDirectory}
                    class="touch-active flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-white/60 transition-all hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>

                {/* Receive Button */}
                <button
                  onClick={handleReceive}
                  disabled={!receiveTicket() || isReceiving()}
                  class="touch-active mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-indigo-600 to-purple-600 font-semibold text-white transition-all hover:shadow-lg hover:shadow-indigo-500/25 disabled:opacity-50"
                >
                  <Show
                    when={isReceiving()}
                    fallback={
                      <>
                        <Download size={18} /> Connect & Receive
                      </>
                    }
                  >
                    <Loader2 size={18} class="animate-spin" />
                    {receiveProgress()}%
                  </Show>
                </button>
              </div>

              {/* Text Transfer Card */}
              <div class="glass-liquid rounded-2xl border border-white/10 p-4">
                <h2 class="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                  <MessageSquare size={18} class="text-purple-400" />
                  Send Text
                </h2>

                {/* Text Input */}
                <textarea
                  value={sendTextContent()}
                  onInput={(e) => setSendTextContent(e.currentTarget.value)}
                  placeholder="Enter text to send..."
                  class="h-20 w-full resize-none rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 p-3 font-mono text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none"
                />

                {/* Send Text Button */}
                <button
                  onClick={handleSendText}
                  disabled={!sendTextContent() || isSendingText()}
                  class="touch-active mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-purple-600 to-indigo-600 font-semibold text-white transition-all hover:shadow-lg hover:shadow-purple-500/25 disabled:opacity-50"
                >
                  <Show
                    when={isSendingText()}
                    fallback={
                      <>
                        <Zap size={18} /> Generate Ticket
                      </>
                    }
                  >
                    <Loader2 size={18} class="animate-spin" />
                  </Show>
                </button>

                {/* Text Ticket Display */}
                <Show when={textSendTicket()}>
                  <Motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    class="mt-3 overflow-hidden"
                  >
                    <div class="glass-inset rounded-xl p-3">
                      <div class="mb-2 flex items-center justify-between">
                        <span class="text-xs text-gray-500 dark:text-white/50">Text Ticket</span>
                        <div class="flex gap-2">
                          <button
                            onClick={() =>
                              navigator.clipboard.writeText(textSendTicket()!)
                            }
                            class="rounded-lg bg-gray-100 dark:bg-white/5 p-1.5 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            onClick={() => shareText(textSendTicket()!)}
                            class="rounded-lg bg-gray-100 dark:bg-white/5 p-1.5 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                          >
                            <Share2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p class="font-mono text-xs break-all text-gray-700 dark:text-white/80">
                        {textSendTicket()}
                      </p>
                    </div>
                  </Motion.div>
                </Show>

                {/* Divider */}
                <div class="my-4 flex items-center gap-2">
                  <div class="h-px flex-1 bg-white/10" />
                  <span class="text-xs text-gray-500 dark:text-white/30">OR</span>
                  <div class="h-px flex-1 bg-white/10" />
                </div>

                {/* Receive Text */}
                <h3 class="mb-2 text-sm font-medium text-gray-700 dark:text-white/70">
                  Receive Text
                </h3>
                <input
                  type="text"
                  value={receiveTextTicket()}
                  onInput={(e) => setReceiveTextTicket(e.currentTarget.value)}
                  placeholder="Paste text ticket..."
                  class="h-12 w-full rounded-xl border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-white/5 px-4 font-mono text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/20 focus:border-purple-500/50 focus:outline-none"
                />

                <button
                  onClick={handleReceiveText}
                  disabled={!receiveTextTicket() || isReceivingText()}
                  class="touch-active mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-indigo-600 to-purple-600 font-semibold text-white transition-all hover:shadow-lg hover:shadow-indigo-500/25 disabled:opacity-50"
                >
                  <Show
                    when={isReceivingText()}
                    fallback={
                      <>
                        <Download size={18} /> Receive Text
                      </>
                    }
                  >
                    <Loader2 size={18} class="animate-spin" />
                  </Show>
                </button>

                {/* Received Text Display */}
                <Show when={receivedText()}>
                  <Motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    class="mt-3 overflow-hidden"
                  >
                    <div class="glass-inset rounded-xl p-3">
                      <div class="mb-2 flex items-center justify-between">
                        <span class="text-xs text-gray-500 dark:text-white/50">
                          Received: {receivedTextFilename()}
                        </span>
                        <button
                          onClick={copyReceivedText}
                          class="rounded-lg bg-gray-100 dark:bg-white/5 p-1.5 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                        >
                          <Clipboard size={14} />
                        </button>
                      </div>
                      <pre class="max-h-24 overflow-y-auto font-mono text-xs break-words whitespace-pre-wrap text-white/80">
                        {receivedText()}
                      </pre>
                    </div>
                  </Motion.div>
                </Show>
              </div>
            </Motion.div>
          </Show>

          <Show when={mobileTab() === "history"}>
            <Motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <h2 class="mb-3 text-base font-semibold text-white">
                Transfer History
              </h2>

              <Show
                when={transfers().length > 0}
                fallback={
                  <div class="glass-liquid rounded-2xl border border-white/10 p-8 text-center">
                    <History size={40} class="mx-auto mb-3 text-white/20" />
                    <p class="text-sm text-gray-500 dark:text-white/40">No transfers yet</p>
                  </div>
                }
              >
                <div class="space-y-2">
                  <For each={transfers()}>
                    {(transfer) => (
                      <div class="glass-liquid rounded-xl border border-white/5 p-3">
                        <div class="flex items-center gap-3">
                          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
                            {getFileIcon(
                              transfer.transfer_type === "send"
                                ? "file"
                                : "download",
                            )}
                          </div>
                          <div class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
                              {getDisplayName(transfer.path)}
                            </p>
                            <p class="text-xs text-gray-500 dark:text-white/40">
                              {formatDate(transfer.created_at)}
                            </p>
                          </div>
                          <div class="flex items-center gap-2">
                            <span
                              class={`rounded-full px-2 py-1 text-xs ${
                                transfer.status === "completed"
                                  ? "bg-green-500/20 text-green-400"
                                  : transfer.status === "error"
                                    ? "bg-red-500/20 text-red-400"
                                    : "bg-yellow-500/20 text-yellow-400"
                              }`}
                            >
                              {getTransferStatus(transfer.status)}
                            </span>
                            <button
                              onClick={() => handleDeleteTransfer(transfer)}
                              class="rounded-lg p-1.5 text-white/40 hover:text-red-400"
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

          <Show when={mobileTab() === "settings"}>
            <Motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <h2 class="mb-3 text-base font-semibold text-white">Settings</h2>

              <div class="space-y-3">
                <div class="glass-liquid rounded-xl border border-white/5 p-4">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium text-gray-900 dark:text-white">Theme</p>
                      <p class="text-xs text-gray-500 dark:text-white/40">Choose appearance</p>
                    </div>
                    <div class="flex gap-1 rounded-lg bg-white/5 p-1">
                      <For each={["light", "dark", "system"] as Theme[]}>
                        {(t) => (
                          <button
                            onClick={() => setThemeValue(t)}
                            class={`rounded-md px-3 py-1.5 text-xs transition-all ${
                              theme() === t
                                ? "bg-purple-500/20 text-purple-400"
                                : "text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white"
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
      <nav class="glass-liquid pb-safe fixed right-0 bottom-0 left-0 z-50 border-t border-white/5">
        <div class="flex h-16 items-center justify-around px-4">
          <button
            onClick={() => setMobileTab("home")}
            class={`flex flex-col items-center gap-1 rounded-xl p-2 transition-all ${
              mobileTab() === "home" ? "text-purple-400" : "text-gray-500 dark:text-white/40"
            }`}
          >
            <Home size={20} />
            <span class="text-[10px]">Home</span>
          </button>

          <button
            onClick={() => setMobileTab("history")}
            class={`flex flex-col items-center gap-1 rounded-xl p-2 transition-all ${
              mobileTab() === "history" ? "text-purple-400" : "text-gray-500 dark:text-white/40"
            }`}
          >
            <History size={20} />
            <span class="text-[10px]">History</span>
          </button>

          <button
            onClick={() => setMobileTab("settings")}
            class={`flex flex-col items-center gap-1 rounded-xl p-2 transition-all ${
              mobileTab() === "settings" ? "text-purple-400" : "text-gray-500 dark:text-white/40"
            }`}
          >
            <Settings size={20} />
            <span class="text-[10px]">Settings</span>
          </button>
        </div>
      </nav>
    </div>
  );

  // ==================== LOADING UI ====================
  const LoadingUI = () => (
    <div class="flex min-h-screen items-center justify-center bg-[#120e26]">
      <div class="text-center">
        <div class="mb-4 flex items-center justify-center gap-3">
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-purple-500 to-indigo-600 shadow-xl shadow-purple-500/20">
            <Sparkles size={24} class="text-purple-600 dark:text-white" />
          </div>
        </div>
        <Loader2 class="mx-auto animate-spin text-purple-400" size={24} />
        <p class="mt-4 text-sm text-gray-500 dark:text-white/50">Loading...</p>
      </div>
    </div>
  );

  // ==================== RENDER ====================
  return (
    <>
      <Toaster />
      <Show
        when={!isInitializing()}
        fallback={<LoadingUI />}
      >
        <Show
          when={showMobileUI()}
          fallback={<DesktopUI />}
        >
          <MobileUI />
        </Show>
      </Show>
    </>
  );
}

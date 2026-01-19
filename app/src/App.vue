<script setup lang="ts">
import "vue-sonner/style.css";
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { platform } from "@tauri-apps/plugin-os";
import QRCode from "qrcode";
import {
  send_file,
  receive_file,
  cancel_transfer,
  get_transfers,
  clear_transfers,
  open_received_file,
  scan_barcode,
  pick_directory,
} from "@/lib/commands";
import Button from "@/components/ui/button/Button.vue";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/sonner";
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
  ChevronDown,
  Scan,
} from "lucide-vue-next";
import { toast } from "vue-sonner";
import { shareText } from "./lib/sharesheet";

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

// State
const activeTab = ref("send");
const transfers = ref<Transfer[]>([]);

// Send state
const sendPath = ref("");
const sendTicketType = ref("relay_and_addresses");
const sendTicket = ref("");
const sendTicketQrCode = ref("");
const isSending = ref(false);

// Receive state
const receiveTicket = ref("");
const receiveOutputDir = useLocalStorage("receive-output-dir", "");
const isReceiving = ref(false);

// Progress state
const progressData = ref<Record<string, ProgressData>>({});
const metadataCache = ref<Record<string, any>>({});
const unlisten = ref<(() => void) | null>(null);
const currentReceivingId = ref<string | null>(null);
const isMobile = ref(false);

// Computed properties for receive progress
const receiveProgress = computed(() => {
  if (!currentReceivingId.value) {
    return 0;
  }
  const data = progressData.value[currentReceivingId.value];
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
});

// Theme state
type Theme = "light" | "dark" | "system";
const theme = ref<Theme>("system");

function setTheme(newTheme: Theme) {
  theme.value = newTheme;
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
  const currentIndex = themes.indexOf(theme.value);
  const nextTheme = themes[(currentIndex + 1) % themes.length];
  setTheme(nextTheme);
}

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

onMounted(async () => {
  // Initialize theme from localStorage or default to system
  const savedTheme = localStorage.getItem("theme") as Theme | null;
  setTheme(savedTheme || "system");

  // Load transfers
  await loadTransfers();

  // Detect mobile platform
  const currentPlatform = await platform();
  isMobile.value = currentPlatform === "android" || currentPlatform === "ios";

  // Listen for progress events
  unlisten.value = await listen<ProgressUpdate>("progress", (event) => {
    const { transfer_id, ...data } = event.payload.data;
    progressData.value[transfer_id] = { transfer_id, ...data };

    // Auto-track receiving transfers
    if (!currentReceivingId.value && data.progress?.type === "metadata") {
      currentReceivingId.value = transfer_id;
    }

    // Clear currentReceivingId when download completes
    if (
      currentReceivingId.value === transfer_id &&
      data.progress?.type === "completed"
    ) {
      // Keep showing for a moment then clear
      setTimeout(() => {
        if (currentReceivingId.value === transfer_id) {
          currentReceivingId.value = null;
        }
      }, 2000);
    }

    // Cache metadata when it arrives
    if (data.progress?.type === "metadata") {
      metadataCache.value[transfer_id] = data.progress;
    }
  });
});

onUnmounted(() => {
  if (unlisten.value) {
    unlisten.value();
  }
});

async function loadTransfers() {
  try {
    const loaded = await get_transfers();
    // Sort by created_at descending (newest first)
    transfers.value = loaded.sort((a, b) => b.created_at - a.created_at);
  } catch (e) {
    console.error("Failed to load transfers:", e);
  }
}

async function handleSend() {
  if (!sendPath.value) {
    return;
  }

  isSending.value = true;
  sendTicket.value = "";
  sendTicketQrCode.value = "";

  try {
    const result = await send_file({
      path: sendPath.value,
      ticket_type: sendTicketType.value,
    });
    sendTicket.value = result;
    // Generate QR code for the ticket
    sendTicketQrCode.value = await QRCode.toDataURL(result, {
      errorCorrectionLevel: "H",
      width: 300,
    });
    await loadTransfers();
  } catch (e) {
    console.error("Send failed:", e);
    toast.error(`Send failed: ${e}`);
  } finally {
    isSending.value = false;
  }
}

async function handleReceive() {
  if (!receiveTicket.value) {
    return;
  }

  isReceiving.value = true;
  currentReceivingId.value = null;

  try {
    await receive_file({
      ticket: receiveTicket.value,
      output_dir: receiveOutputDir.value || undefined,
    });
    // currentReceivingId will be set by progress event listener
    await loadTransfers();
    receiveTicket.value = "";
    toast.success("Receive operation started");
  } catch (e) {
    console.error("Receive failed:", e);
    toast.error(`Receive failed: ${e}`);
    currentReceivingId.value = null;
  } finally {
    isReceiving.value = false;
  }
}

async function handleCancelReceive() {
  if (currentReceivingId.value) {
    await handleCancel(currentReceivingId.value);
    currentReceivingId.value = null;
  }
}

async function handleScanBarcode() {
  try {
    const result = await scan_barcode();
    receiveTicket.value = result;
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
    transfers.value = [];
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

function getTransferStatus(status: string): {
  label: string;
  color: string;
  icon: any;
  pulse: boolean;
} {
  const s = status.toLowerCase();
  if (s.includes("error"))
    return { label: "Error", color: "text-red-500", icon: X, pulse: false };
  if (s.includes("cancel"))
    return {
      label: "Cancelled",
      color: "text-yellow-500",
      icon: X,
      pulse: false,
    };
  if (s.includes("complete"))
    return {
      label: "Completed",
      color: "text-green-500",
      icon: Check,
      pulse: false,
    };
  if (s.includes("serving"))
    return {
      label: "Serving",
      color: "text-blue-500",
      icon: Share2,
      pulse: true,
    };
  if (s.includes("downloading"))
    return {
      label: "Downloading",
      color: "text-blue-500",
      icon: Download,
      pulse: true,
    };
  return {
    label: status,
    color: "text-gray-500",
    icon: RefreshCw,
    pulse: true,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success("Ticket copied to clipboard");
}

// File picker functions
async function selectFile() {
  try {
    const selected = await open({
      multiple: false,
      directory: false,
    });
    if (selected && typeof selected === "string") {
      sendPath.value = selected;
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
      sendPath.value = selected;
    }
  } catch (e) {
    console.error("Failed to select directory:", e);
  }
}

async function selectOutputDirectory() {
  try {
    console.log("isMobile=", isMobile.value);

    if (isMobile.value) {
      // On mobile, use the pick_directory command
      const result = await pick_directory();
      receiveOutputDir.value = result.uri;
    } else {
      // On desktop, use the dialog picker
      const selected = await open({
        multiple: false,
        directory: true,
      });
      if (selected && typeof selected === "string") {
        receiveOutputDir.value = selected;
      }
    }
  } catch (e) {
    console.error("Failed to select output directory:", e);
    toast.error("Failed to select folder", {
      description: String(e),
    });
  }
}

function getDisplayName(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function getTransferDisplayName(transfer: Transfer): string {
  // For receive transfers, try to get filename from metadata
  if (
    transfer.transfer_type === "receive" &&
    metadataCache.value[transfer.id]?.names?.length > 0
  ) {
    const names = metadataCache.value[transfer.id].names;
    if (names.length === 1) {
      return names[0];
    }
    // Multiple files - show first name with count
    return `${names[0]} (+${names.length - 1} more)`;
  }
  // For send transfers or when metadata unavailable, use path
  return getDisplayName(transfer.path);
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext!))
    return FileImage;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext!)) return FileArchive;
  if (["ts", "js", "py", "rs", "go", "html", "css", "vue"].includes(ext!))
    return FileCode;
  return FileText;
}

function getTransferFileIcon(transfer: Transfer) {
  // For receive transfers with metadata, use first file name
  if (
    transfer.transfer_type === "receive" &&
    metadataCache.value[transfer.id]?.names?.length > 0
  ) {
    return getFileIcon(metadataCache.value[transfer.id].names[0]);
  }
  // For send transfers, use path
  return getFileIcon(transfer.path);
}

function getProgressValue(id: string) {
  const data = progressData.value[id];
  if (data?.progress?.type === "downloading") {
    return (data.progress.offset / data.progress.total) * 100;
  }
  return 0;
}
</script>

<template>
  <Toaster />

  <div
    class="fixed inset-0 pointer-events-none overflow-hidden blur-[120px] opacity-20 dark:opacity-40"
  >
    <div
      class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500 rounded-full animate-pulse"
    ></div>
    <div
      class="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500 rounded-full animate-pulse"
      style="animation-delay: 2s"
    ></div>
  </div>

  <main class="min-h-screen relative flex items-center justify-center p-4">
    <div
      class="w-full max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000"
    >
      <!-- Header -->
      <header class="relative mt-10 md:mt-2">
        <div class="text-center space-y-2">
          <h1
            class="text-4xl sm:text-5xl font-extrabold tracking-tighter text-slate-900 dark:text-slate-50 text-glow"
          >
            Sendme
          </h1>
          <p
            class="text-slate-500 dark:text-slate-400 font-medium tracking-wide"
          >
            PEER-TO-PEER • POWERED BY IROH
          </p>
        </div>
        <button
          @click="toggleTheme"
          class="absolute top-0 right-0 p-2 rounded-xl hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
          :title="`Current theme: ${theme}`"
        >
          <Sun v-if="theme === 'light'" class="w-5 h-5 text-slate-700" />
          <Moon v-else-if="theme === 'dark'" class="w-5 h-5 text-slate-300" />
          <Monitor v-else class="w-5 h-5 text-slate-700 dark:text-slate-300" />
        </button>
      </header>

      <!-- Main Container -->
      <div class="glass rounded-2xl sm:rounded-3xl overflow-hidden">
        <Tabs v-model="activeTab" class="w-full">
          <TabsList
            class="flex w-full h-auto bg-transparent p-2 gap-2 border-b border-white/10"
          >
            <TabsTrigger
              value="send"
              class="flex-1 py-3 text-sm font-semibold rounded-xl transition-all data-[state=active]:bg-white/10 data-[state=active]:text-secondary-foreground dark:data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              <Send class="w-4 h-4 mr-2" />
              Send
            </TabsTrigger>
            <TabsTrigger
              value="receive"
              class="flex-1 py-3 text-sm font-semibold rounded-xl transition-all data-[state=active]:bg-white/10 data-[state=active]:text-secondary-foreground dark:data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              <Download class="w-4 h-4 mr-2" />
              Receive
            </TabsTrigger>
          </TabsList>

          <div class="p-4 sm:p-6 md:p-8">
            <!-- Send Tab -->
            <TabsContent value="send" class="space-y-6 mt-0 outline-none">
              <div class="space-y-6">
                <!-- Drop Zone Area -->
                <div
                  class="group relative flex flex-col items-center justify-center p-6 sm:p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl hover:border-primary/50 hover:bg-white/5 transition-all cursor-pointer"
                  @click="selectFile"
                >
                  <div
                    class="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"
                  >
                    <FolderOpen class="w-8 h-8 text-primary" />
                  </div>
                  <template v-if="!sendPath">
                    <h3
                      class="font-semibold text-slate-900 dark:text-slate-200 text-lg"
                    >
                      Click to select a file
                    </h3>
                    <p class="text-sm text-slate-500 dark:text-slate-500 mt-1">
                      or select a directory below
                    </p>
                  </template>
                  <template v-else>
                    <h3
                      class="font-semibold text-primary text-center break-all text-lg"
                    >
                      {{ getDisplayName(sendPath) }}
                    </h3>
                    <p
                      class="text-sm text-slate-500 dark:text-slate-500 mt-1 truncate max-w-[80%]"
                    >
                      {{ sendPath }}
                    </p>
                  </template>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button
                    type="button"
                    @click="selectDirectory"
                    :disabled="isSending"
                    variant="secondary"
                    class="h-12 rounded-xl"
                  >
                    <FolderOpen class="h-4 w-4 mr-2" />
                    Select Directory
                  </Button>

                  <Popover>
                    <PopoverTrigger as-child>
                      <Button
                        variant="secondary"
                        class="h-12 rounded-xl justify-between"
                        :disabled="isSending"
                      >
                        <span class="truncate">{{
                          ticketTypes.find((t) => t.value === sendTicketType)
                            ?.label
                        }}</span>
                        <ChevronRight class="h-4 w-4 opacity-50 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      class="w-64 p-2 glass-card rounded-2xl border-white/10"
                    >
                      <div class="space-y-1">
                        <button
                          v-for="type in ticketTypes"
                          :key="type.value"
                          @click="sendTicketType = type.value"
                          class="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 transition-all"
                          :class="{
                            'bg-white/10': sendTicketType === type.value,
                          }"
                        >
                          <div class="font-semibold text-sm">
                            {{ type.label }}
                          </div>
                          <div class="text-xs text-slate-500">
                            {{ type.description }}
                          </div>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <Button
                  @click="handleSend"
                  :disabled="!sendPath || isSending"
                  class="w-full h-14 text-lg font-bold rounded-2xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all"
                >
                  <Loader2 v-if="isSending" class="mr-2 h-5 w-5 animate-spin" />
                  <Send v-else class="mr-2 h-5 w-5" />
                  {{ isSending ? "Generating Ticket..." : "Share File" }}
                </Button>

                <!-- Ticket Display -->
                <transition
                  enter-active-class="transition-all duration-500 ease-out"
                  enter-from-class="opacity-0 translate-y-4 scale-95"
                  enter-to-class="opacity-100 translate-y-0 scale-100"
                >
                  <div
                    v-if="sendTicket"
                    class="p-4 sm:p-6 glass-card rounded-2xl space-y-4 border-primary/20 ring-1 ring-primary/20"
                  >
                    <div class="flex items-center justify-between">
                      <Label
                        class="text-xs font-bold uppercase tracking-widest text-primary"
                        >Shareable Ticket</Label
                      >
                      <Share2
                        class="w-4 h-4 text-primary opacity-50 cursor-pointer"
                        @click="shareText(sendTicket)"
                      />
                    </div>

                    <!-- QR Code Display -->
                    <div
                      v-if="sendTicketQrCode"
                      class="flex justify-center p-4 bg-white rounded-xl"
                    >
                      <img
                        :src="sendTicketQrCode"
                        alt="Ticket QR Code"
                        class="w-48 h-48 object-contain"
                      />
                    </div>

                    <div
                      class="p-4 bg-black/5 dark:bg-white/5 rounded-xl break-all text-sm text-black font-mono leading-relaxed border border-white/5"
                    >
                      {{ sendTicket }}
                    </div>
                    <Button
                      @click="copyToClipboard(sendTicket)"
                      variant="default"
                      class="w-full h-12 rounded-xl font-bold"
                    >
                      <Copy class="w-4 h-4 mr-2" />
                      Copy Ticket
                    </Button>
                  </div>
                </transition>
              </div>
            </TabsContent>

            <!-- Receive Tab -->
            <TabsContent value="receive" class="space-y-6 mt-0 outline-none">
              <div class="space-y-6">
                <div class="space-y-3">
                  <Label
                    for="receive-ticket"
                    class="text-sm font-semibold opacity-70 ml-1"
                    >Universal Ticket</Label
                  >
                  <div class="flex gap-2">
                    <div class="relative flex-1">
                      <Input
                        id="receive-ticket"
                        v-model="receiveTicket"
                        placeholder="Paste ticket or scan QR code..."
                        :disabled="isReceiving"
                        class="h-14 rounded-2xl pl-12 glass shadow-none border-white/10 focus:ring-primary/40 focus:border-primary/40"
                      />
                      <Share2
                        class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 opacity-40"
                      />
                    </div>
                    <Button
                      v-if="isMobile"
                      type="button"
                      @click="handleScanBarcode"
                      :disabled="isReceiving"
                      variant="secondary"
                      class="h-14 w-14 rounded-2xl p-0 flex-shrink-0"
                      title="Scan QR Code"
                    >
                      <Scan class="h-5 w-5" />
                    </Button>
                  </div>
                </div>

                <div class="space-y-3">
                  <Label
                    for="output-dir"
                    class="text-sm font-semibold opacity-70 ml-1"
                    >Destination Folder (Optional)</Label
                  >
                  <div class="flex gap-2">
                    <Input
                      id="output-dir"
                      v-model="receiveOutputDir"
                      placeholder="Default downloads folder"
                      :disabled="isReceiving"
                      class="h-14 rounded-2xl glass shadow-none border-white/10"
                      readonly
                    />
                    <Button
                      type="button"
                      @click="selectOutputDirectory"
                      :disabled="isReceiving"
                      variant="secondary"
                      class="h-14 w-14 rounded-2xl p-0 flex-shrink-0"
                    >
                      <FolderOpen class="h-5 w-5" />
                    </Button>
                  </div>
                </div>

                <div class="relative group">
                  <Button
                    @click="
                      currentReceivingId
                        ? handleCancelReceive()
                        : handleReceive()
                    "
                    :disabled="
                      !receiveTicket || (isReceiving && !currentReceivingId)
                    "
                    class="relative w-full h-14 text-lg font-bold rounded-2xl overflow-hidden transition-all"
                    :class="
                      currentReceivingId
                        ? 'bg-slate-900/90 dark:bg-slate-800/90 hover:bg-red-500/20'
                        : 'bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20'
                    "
                  >
                    <template v-if="currentReceivingId">
                      <span
                        class="relative z-10 group-hover:opacity-0 transition-opacity"
                      >
                        {{ Math.round(receiveProgress) }}%
                      </span>
                      <!-- Hover overlay for cancel hint -->
                      <div
                        class="absolute inset-0 flex items-center justify-center bg-red-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20"
                      >
                        <span class="flex items-center"> Click to Cancel </span>
                      </div>
                    </template>
                    <template v-else>
                      <Loader2
                        v-if="isReceiving"
                        class="mr-2 h-5 w-5 animate-spin"
                      />
                      <Download v-else class="mr-2 h-5 w-5" />
                      {{ isReceiving ? "Connecting..." : "Connect & Receive" }}
                    </template>
                  </Button>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <!-- Transfers List -->
      <div v-if="transfers.length > 0" class="space-y-4">
        <div class="flex items-center justify-between px-2">
          <h2
            class="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center"
          >
            Recent Activity
            <span
              class="ml-2 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full"
              >{{ transfers.length }}</span
            >
          </h2>
          <div class="flex items-center gap-2">
            <button
              @click="loadTransfers"
              class="text-xs font-semibold text-primary hover:underline flex items-center"
            >
              <RefreshCw class="w-3 h-3 mr-1" />
              Sync
            </button>
            <button
              v-if="transfers.length > 0"
              @click="handleClearTransfers"
              class="text-xs font-semibold text-red-500 hover:text-red-600 hover:underline flex items-center"
            >
              <Trash2 class="w-3 h-3 mr-1" />
              Clear
            </button>
          </div>
        </div>

        <div class="space-y-3">
          <transition-group
            name="list"
            enter-active-class="transition duration-500 ease-out"
            enter-from-class="opacity-0 translate-x-4"
            enter-to-class="opacity-100 translate-x-0"
          >
            <div
              v-for="transfer in transfers"
              :key="transfer.id"
              class="glass-card group p-4 sm:p-5 rounded-2xl hover:scale-[1.01] transition-all duration-300"
            >
              <div class="flex items-start gap-4">
                <div
                  class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  :class="
                    transfer.transfer_type === 'send'
                      ? 'bg-blue-500/10 text-blue-500'
                      : 'bg-green-500/10 text-green-500'
                  "
                >
                  <component
                    :is="getTransferFileIcon(transfer)"
                    class="w-6 h-6"
                  />
                </div>

                <div class="flex-1 min-w-0 space-y-1">
                  <div class="flex items-center justify-between">
                    <h4
                      class="font-bold truncate pr-4"
                      :class="{
                        'text-slate-900 dark:text-slate-100': true,
                        'cursor-pointer hover:text-green-600 dark:hover:text-green-400 hover:underline':
                          transfer.transfer_type === 'receive' &&
                          transfer.status.includes('complete'),
                      }"
                      @click="handleOpenFile(transfer)"
                      :title="
                        transfer.transfer_type === 'receive' &&
                        transfer.status.includes('complete')
                          ? 'Click to open file'
                          : ''
                      "
                    >
                      {{ getTransferDisplayName(transfer) }}
                    </h4>
                    <span
                      class="text-[10px] font-black uppercase tracking-tighter px-2 py-0.5 rounded-md"
                      :class="
                        transfer.transfer_type === 'send'
                          ? 'bg-blue-500/20 text-blue-500'
                          : 'bg-green-500/20 text-green-500'
                      "
                    >
                      {{ transfer.transfer_type }}
                    </span>
                  </div>

                  <div
                    class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 font-medium"
                  >
                    <div
                      class="flex items-center gap-1"
                      :class="getTransferStatus(transfer.status).color"
                    >
                      <component
                        :is="getTransferStatus(transfer.status).icon"
                        class="w-3 h-3"
                        :class="{
                          'animate-spin':
                            getTransferStatus(transfer.status).pulse &&
                            transfer.status.includes('RefreshCw'),
                        }"
                      />
                      {{ getTransferStatus(transfer.status).label }}
                    </div>
                    <span class="opacity-20 hidden sm:inline">•</span>
                    <div class="flex items-center gap-1">
                      <Monitor class="w-3 h-3 opacity-50" />
                      {{ formatDate(transfer.created_at) }}
                    </div>
                  </div>

                  <!-- Progress Section -->
                  <div
                    v-if="progressData[transfer.id]"
                    class="mt-4 pt-4 border-t border-white/5 space-y-2"
                  >
                    <!-- Metadata Display (shown when available, persists during download) -->
                    <div
                      v-if="
                        progressData[transfer.id].progress?.type ===
                          'metadata' || metadataCache[transfer.id]
                      "
                      class="space-y-2 p-3 bg-black/5 dark:bg-white/5 rounded-xl"
                    >
                      <div
                        class="flex items-center gap-2 text-xs font-bold text-primary"
                      >
                        <FileText class="w-3 h-3" />
                        Transfer Information
                      </div>
                      <div class="space-y-1 text-xs">
                        <div class="flex justify-between">
                          <span class="opacity-60">Files:</span>
                          <span class="font-mono font-semibold">{{
                            (progressData[transfer.id].progress?.type ===
                            "metadata"
                              ? progressData[transfer.id].progress.file_count
                              : metadataCache[transfer.id]?.file_count) || 0
                          }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="opacity-60">Size:</span>
                          <span class="font-mono font-semibold">{{
                            formatFileSize(
                              (progressData[transfer.id].progress?.type ===
                              "metadata"
                                ? progressData[transfer.id].progress.total_size
                                : metadataCache[transfer.id]?.total_size) || 0,
                            )
                          }}</span>
                        </div>
                        <div
                          v-if="
                            (progressData[transfer.id].progress?.type ===
                            'metadata'
                              ? progressData[transfer.id].progress.names?.length
                              : metadataCache[transfer.id]?.names?.length) > 0
                          "
                          class="pt-2 border-t border-white/5"
                        >
                          <div class="opacity-60 mb-1">Contents:</div>
                          <div class="space-y-0.5 pl-2">
                            <div
                              v-for="(name, i) in (progressData[transfer.id]
                                .progress?.type === 'metadata'
                                ? progressData[transfer.id].progress.names
                                : metadataCache[transfer.id]?.names || []
                              ).slice(0, 3)"
                              :key="i"
                              class="text-[10px] font-mono opacity-80 truncate"
                            >
                              {{ name }}
                            </div>
                            <div
                              v-if="
                                (progressData[transfer.id].progress?.type ===
                                'metadata'
                                  ? progressData[transfer.id].progress.names
                                      ?.length
                                  : metadataCache[transfer.id]?.names?.length ||
                                    0) > 3
                              "
                              class="text-[10px] opacity-50"
                            >
                              +{{
                                (progressData[transfer.id].progress?.type ===
                                "metadata"
                                  ? progressData[transfer.id].progress.names
                                      ?.length
                                  : metadataCache[transfer.id]?.names?.length ||
                                    0) - 3
                              }}
                              more...
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Download Progress -->
                    <div
                      v-if="
                        progressData[transfer.id].progress?.type ===
                        'downloading'
                      "
                    >
                      <div
                        class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide opacity-50"
                      >
                        <span>{{
                          progressData[transfer.id].name || "Transferring..."
                        }}</span>
                        <span>
                          {{ Math.round(getProgressValue(transfer.id)) }}%
                        </span>
                      </div>
                      <Progress
                        :value="getProgressValue(transfer.id)"
                        class="h-1.5 bg-slate-200/20"
                      />
                      <div class="text-[10px] text-right font-mono opacity-50">
                        {{
                          formatFileSize(
                            progressData[transfer.id].progress.offset,
                          )
                        }}
                        /
                        {{
                          formatFileSize(
                            progressData[transfer.id].progress.total,
                          )
                        }}
                      </div>
                    </div>
                  </div>
                </div>

                <div class="flex items-start self-stretch">
                  <button
                    v-if="
                      !transfer.status.includes('complete') &&
                      !transfer.status.includes('error') &&
                      !transfer.status.includes('cancel')
                    "
                    @click="handleCancel(transfer.id)"
                    class="p-2 hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors group/cancel"
                    title="Abort Transfer"
                  >
                    <X class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </transition-group>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="transfers.length === 0" class="text-center py-12 space-y-4">
        <div
          class="w-20 h-20 bg-slate-500/5 rounded-full flex items-center justify-center mx-auto opacity-20"
        >
          <Share2 class="w-8 h-8" />
        </div>
        <div class="space-y-1">
          <p class="text-slate-500 font-semibold">Ready for departure</p>
          <p class="text-xs text-slate-500/60">
            Your transfer activity will appear here
          </p>
        </div>
      </div>
    </div>
  </main>
</template>

<style>
:root {
  font-family:
    "Inter",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Oxygen,
    Ubuntu,
    Cantarell,
    "Open Sans",
    "Helvetica Neue",
    sans-serif;
}

/* Base fade-in for entire app */
@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.animate-in {
  animation: fade-in 0.8s ease-out forwards;
}

/* Custom scrollbar override for glass */
::-webkit-scrollbar {
  width: 5px;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.dark ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

button {
  -webkit-tap-highlight-color: transparent;
}
</style>

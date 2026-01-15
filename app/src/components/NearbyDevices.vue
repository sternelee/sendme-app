<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import {
  start_nearby_discovery,
  get_nearby_devices,
  stop_nearby_discovery,
  get_hostname,
  get_device_model,
  check_wifi_connection,
  type NearbyDevice,
} from "@/lib/commands";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import {
  Wifi,
  WifiOff,
  Laptop,
  Smartphone,
  Monitor,
  Info,
} from "lucide-vue-next";
import { toast } from "vue-sonner";

const emit = defineEmits<{
  selectDevice: [device: NearbyDevice];
}>();

// State
const isScanning = ref(false);
const devices = ref<NearbyDevice[]>([]);
const localNodeId = ref<string>("");
const localHostname = ref<string>("");
const deviceModel = ref<string>("");
const refreshInterval = ref<number | null>(null);
const isWifiConnected = ref(false);
const wifiCheckInterval = ref<number | null>(null);

// System info for debugging
const systemInfo = ref<Record<string, string>>({});

// Computed
const availableDevices = computed(() => {
  return devices.value.filter((d) => d.available);
});

onMounted(async () => {
  await checkWifiStatus();
  await startDiscovery();
  await loadLocalHostname();
  await loadDeviceModel();
  await loadSystemInfo();

  // Check WiFi status every 10 seconds
  wifiCheckInterval.value = window.setInterval(async () => {
    await checkWifiStatus();
  }, 10000);
});

onUnmounted(async () => {
  if (wifiCheckInterval.value) {
    clearInterval(wifiCheckInterval.value);
    wifiCheckInterval.value = null;
  }
  await stopDiscovery();
});

async function checkWifiStatus() {
  try {
    isWifiConnected.value = await check_wifi_connection();
    if (!isWifiConnected.value && isScanning.value) {
      // WiFi disconnected while scanning
      await stopDiscovery();
      toast.error("WiFi connection lost. Nearby discovery stopped.");
    }
  } catch (e) {
    console.error("Failed to check WiFi status:", e);
  }
}

async function loadLocalHostname() {
  try {
    localHostname.value = await get_hostname();
  } catch (e) {
    console.error("Failed to get hostname:", e);
  }
}

async function loadDeviceModel() {
  try {
    deviceModel.value = await get_device_model();
  } catch (e) {
    console.error("Failed to get device model:", e);
  }
}

async function loadSystemInfo() {
  try {
    const os = await import("@tauri-apps/plugin-os");
    const info: Record<string, string> = {};

    try {
      info.hostname = (await os.hostname()) ?? "null";
    } catch (e) {
      info.hostname = `Error: ${e}`;
    }
    try {
      info.platform = (await os.platform()) ?? "null";
    } catch (e) {
      info.platform = `Error: ${e}`;
    }
    try {
      info.version = (await os.version()) ?? "null";
    } catch (e) {
      info.version = `Error: ${e}`;
    }
    try {
      info.arch = (await os.arch()) ?? "null";
    } catch (e) {
      info.arch = `Error: ${e}`;
    }
    try {
      info.type = (await os.type()) ?? "null";
    } catch (e) {
      info.type = `Error: ${e}`;
    }
    try {
      info.family = (await os.family()) ?? "null";
    } catch (e) {
      info.family = `Error: ${e}`;
    }
    try {
      info.locale = (await os.locale()) ?? "null";
    } catch (e) {
      info.locale = `Error: ${e}`;
    }
    try {
      info.exeExtension = (await os.exeExtension()) ?? "null";
    } catch (e) {
      info.exeExtension = `Error: ${e}`;
    }
    try {
      info.eol = (await os.eol()) ?? "null";
    } catch (e) {
      info.eol = `Error: ${e}`;
    }

    systemInfo.value = info;
    console.log("System Info:", info);
  } catch (e) {
    console.error("Failed to load system info:", e);
    systemInfo.value = { error: String(e) };
  }
}

async function startDiscovery() {
  try {
    isScanning.value = true;
    localNodeId.value = await start_nearby_discovery();
    toast.success("Nearby discovery started");

    // Refresh devices every 3 seconds
    refreshInterval.value = window.setInterval(async () => {
      await refreshDevices();
    }, 3000);

    // Initial refresh
    await refreshDevices();
  } catch (e) {
    console.error("Failed to start discovery:", e);
    toast.error(`Failed to start discovery: ${e}`);
    isScanning.value = false;
  }
}

async function stopDiscovery() {
  try {
    if (refreshInterval.value) {
      clearInterval(refreshInterval.value);
      refreshInterval.value = null;
    }
    await stop_nearby_discovery();
    isScanning.value = false;
  } catch (e) {
    console.error("Failed to stop discovery:", e);
  }
}

async function refreshDevices() {
  try {
    devices.value = await get_nearby_devices();
  } catch (e) {
    console.error("Failed to get nearby devices:", e);
  }
}

function handleSelectDevice(device: NearbyDevice) {
  emit("selectDevice", device);
}

function formatLastSeen(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

interface DevicePlatform {
  icon: any;
  label: string;
  colorClass: string;
}

function detectDevicePlatform(device: NearbyDevice): DevicePlatform {
  const name = (device.display_name || device.name || "").toLowerCase();

  // Check for iPhone/iPad patterns
  if (
    name.includes("iphone") ||
    name.includes("ipad") ||
    name.includes("ipod")
  ) {
    return {
      icon: Smartphone,
      label: "iOS",
      colorClass: "text-slate-700 dark:text-slate-300",
    };
  }

  // Check for Mac patterns
  if (
    name.includes("macbook") ||
    name.includes("imac") ||
    name.includes("mac mini") ||
    name.includes(".local") ||
    name.includes("mbp") ||
    name.includes("mba")
  ) {
    return {
      icon: Laptop,
      label: "macOS",
      colorClass: "text-slate-700 dark:text-slate-300",
    };
  }

  // Check for Android patterns
  if (
    name.includes("android") ||
    name.includes("pixel") ||
    name.includes("samsung") ||
    name.includes("oneplus") ||
    name.includes("xiaomi") ||
    name.includes("huawei") ||
    name.includes("oppo") ||
    name.includes("vivo") ||
    name.includes("realme")
  ) {
    return {
      icon: Smartphone,
      label: "Android",
      colorClass: "text-green-600 dark:text-green-500",
    };
  }

  // Check for Windows patterns
  if (
    name.includes("windows") ||
    name.includes("desktop-") ||
    name.includes("pc-") ||
    name.includes("win-") ||
    name.includes("laptop-")
  ) {
    return {
      icon: Laptop,
      label: "Windows",
      colorClass: "text-blue-600 dark:text-blue-500",
    };
  }

  // Check for Linux patterns
  if (
    name.includes("linux") ||
    name.includes("ubuntu") ||
    name.includes("debian") ||
    name.includes("fedora") ||
    name.includes("arch")
  ) {
    return {
      icon: Laptop,
      label: "Linux",
      colorClass: "text-orange-600 dark:text-orange-500",
    };
  }

  // Default to generic monitor/device icon
  return {
    icon: Monitor,
    label: "Device",
    colorClass: "text-slate-600 dark:text-slate-400",
  };
}

// Expose state and methods to parent component
defineExpose({
  isScanning,
  availableDevices,
  refreshDevices,
});
</script>

<template>
  <div class="space-y-3">
    <!-- Empty State -->
    <div v-if="availableDevices.length === 0" class="text-center py-3">
      <div
        class="w-10 h-10 bg-slate-500/5 rounded-full flex items-center justify-center mx-auto mb-1.5"
      >
        <WifiOff class="w-4 h-4 opacity-20" />
      </div>
      <p class="text-xs text-slate-500 font-medium">
        {{ isScanning ? "Scanning for devices..." : "No devices found" }}
      </p>
      <p class="text-[10px] text-slate-500/60 mt-0.5">
        Make sure both devices are on the same WiFi
      </p>
      <p
        v-if="!isWifiConnected"
        class="text-[10px] text-amber-600 dark:text-amber-500 mt-1 font-medium"
      >
        WiFi not detected
      </p>
    </div>

    <!-- Horizontal Device List -->
    <div
      v-if="availableDevices.length > 0"
      class="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-thin"
    >
      <div
        v-for="device in availableDevices"
        :key="device.node_id"
        class="flex-shrink-0 w-32 p-3 glass-card rounded-xl hover:scale-105 hover:shadow-lg transition-all duration-200 cursor-pointer group"
        @click="handleSelectDevice(device)"
      >
        <div class="flex flex-col items-center gap-2 text-center">
          <div
            class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-green-500/10 text-green-500 group-hover:bg-green-500/20 transition-colors"
          >
            <component
              :is="detectDevicePlatform(device).icon"
              class="w-6 h-6"
            />
          </div>

          <div class="w-full">
            <h4
              class="font-bold text-xs text-slate-900 dark:text-slate-100 truncate"
              :title="device.display_name"
            >
              {{ device.display_name }}
            </h4>
            <p class="text-[10px] text-slate-500 font-medium mt-0.5">
              {{ formatLastSeen(device.last_seen) }}
            </p>
          </div>

          <div
            v-if="device.ip_addresses.length > 0"
            class="flex items-center gap-1 text-[10px] text-primary font-mono"
          >
            <Wifi class="w-2.5 h-2.5 opacity-50" />
            <span class="truncate max-w-[80px]">{{
              device.ip_addresses[0]
            }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Local Device Info with Hover Card -->
    <div
      v-if="localNodeId || deviceModel || localHostname"
      class="flex items-center justify-center gap-2 py-2 border-t border-slate-200 dark:border-slate-800"
    >
      <p class="text-xs text-slate-500 font-medium flex items-center gap-1.5">
        <span>Your Device:</span>
        <span class="text-slate-700 dark:text-slate-300 font-semibold">{{
          deviceModel || localHostname || "Unknown"
        }}</span>
        <component
          :is="
            detectDevicePlatform({
              display_name: deviceModel || localHostname || '',
              name: null,
              node_id: localNodeId,
              addresses: [],
              ip_addresses: [],
              last_seen: 0,
              available: true,
            }).icon
          "
          class="w-3.5 h-3.5 opacity-60"
          :class="
            detectDevicePlatform({
              display_name: deviceModel || localHostname || '',
              name: null,
              node_id: localNodeId,
              addresses: [],
              ip_addresses: [],
              last_seen: 0,
              available: true,
            }).colorClass
          "
        />
      </p>

      <!-- System Info Hover Card -->
      <HoverCard :open-delay="200" :close-delay="100">
        <HoverCardTrigger as-child>
          <button
            class="p-1 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
            title="View system info"
          >
            <Info
              class="w-3.5 h-3.5 text-slate-500 hover:text-primary transition-colors"
            />
          </button>
        </HoverCardTrigger>
        <HoverCardContent class="w-80" side="bottom" align="center">
          <div class="space-y-3">
            <div class="flex items-center gap-2 border-b border-white/10 pb-2">
              <Info class="w-4 h-4 text-primary" />
              <h4 class="font-bold text-sm">System Information</h4>
            </div>

            <div class="grid grid-cols-2 gap-3 text-xs">
              <div class="space-y-1">
                <div class="font-semibold text-slate-700 dark:text-slate-300">
                  Hostname
                </div>
                <div
                  class="font-mono text-slate-600 dark:text-slate-500 break-all"
                >
                  {{ systemInfo.hostname || "-" }}
                </div>
              </div>

              <div class="space-y-1">
                <div class="font-semibold text-slate-700 dark:text-slate-300">
                  Platform
                </div>
                <div class="font-mono text-slate-600 dark:text-slate-500">
                  {{ systemInfo.platform || "-" }}
                </div>
              </div>

              <div class="space-y-1">
                <div class="font-semibold text-slate-700 dark:text-slate-300">
                  Architecture
                </div>
                <div class="font-mono text-slate-600 dark:text-slate-500">
                  {{ systemInfo.arch || "-" }}
                </div>
              </div>

              <div class="space-y-1">
                <div class="font-semibold text-slate-700 dark:text-slate-300">
                  Type
                </div>
                <div class="font-mono text-slate-600 dark:text-slate-500">
                  {{ systemInfo.type || "-" }}
                </div>
              </div>

              <div class="space-y-1">
                <div class="font-semibold text-slate-700 dark:text-slate-300">
                  Family
                </div>
                <div class="font-mono text-slate-600 dark:text-slate-500">
                  {{ systemInfo.family || "-" }}
                </div>
              </div>

              <div class="space-y-1">
                <div class="font-semibold text-slate-700 dark:text-slate-300">
                  Locale
                </div>
                <div class="font-mono text-slate-600 dark:text-slate-500">
                  {{ systemInfo.locale || "-" }}
                </div>
              </div>

              <div class="space-y-1 col-span-2">
                <div class="font-semibold text-slate-700 dark:text-slate-300">
                  Version
                </div>
                <div
                  class="font-mono text-slate-600 dark:text-slate-500 break-all"
                >
                  {{ systemInfo.version || "-" }}
                </div>
              </div>

              <div class="space-y-1">
                <div class="font-semibold text-primary">Device Model</div>
                <div class="font-mono text-primary break-all">
                  {{ deviceModel || "-" }}
                </div>
              </div>

              <div class="space-y-1">
                <div
                  class="font-semibold"
                  :class="
                    isWifiConnected
                      ? 'text-green-600 dark:text-green-500'
                      : 'text-amber-600 dark:text-amber-500'
                  "
                >
                  WiFi Status
                </div>
                <div
                  class="font-mono font-semibold"
                  :class="
                    isWifiConnected
                      ? 'text-green-600 dark:text-green-500'
                      : 'text-amber-600 dark:text-amber-500'
                  "
                >
                  {{ isWifiConnected ? "✓ Connected" : "✗ Disconnected" }}
                </div>
              </div>
            </div>

            <div
              class="pt-2 border-t border-white/10 text-[10px] font-mono text-slate-500"
            >
              <div class="flex items-center gap-1">
                <span class="flex-shrink-0">Node ID:</span>
                <span
                  class="text-primary truncate"
                  :title="localNodeId || 'Unknown'"
                >
                  {{ localNodeId || "Unknown" }}
                </span>
              </div>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  </div>
</template>

<style scoped>
/* Custom scrollbar for horizontal device list */
.scrollbar-thin::-webkit-scrollbar {
  height: 4px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.3);
  border-radius: 10px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.5);
}

.dark .scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.2);
}

.dark .scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.3);
}
</style>

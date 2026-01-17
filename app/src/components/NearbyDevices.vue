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
import Button from "@/components/ui/button/Button.vue";
import {
  Wifi,
  WifiOff,
  ChevronDown,
  Laptop,
  Smartphone,
  Monitor,
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
const showSystemInfo = ref(false);
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
  <div class="space-y-4">
    <!-- Device List -->
    <div v-if="availableDevices.length === 0" class="text-center py-6">
      <div
        class="w-12 h-12 bg-slate-500/5 rounded-full flex items-center justify-center mx-auto mb-2"
      >
        <WifiOff class="w-5 h-5 opacity-20" />
      </div>
      <p class="text-sm text-slate-500 font-medium">
        {{ isScanning ? "Scanning for devices..." : "No devices found" }}
      </p>
      <p class="text-xs text-slate-500/60 mt-1">
        Make sure both devices are connected to the same WiFi network
      </p>
      <p
        v-if="!isWifiConnected"
        class="text-xs text-amber-600 dark:text-amber-500 mt-2 font-medium"
      >
        WiFi not detected. Nearby discovery requires WiFi connection.
      </p>
    </div>

    <div
      v-for="device in availableDevices"
      :key="device.node_id"
      class="p-3 glass-card rounded-xl hover:scale-[1.01] transition-all duration-200 cursor-pointer group"
      @click="handleSelectDevice(device)"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-green-500/10 text-green-500"
        >
          <Wifi class="w-5 h-5" />
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <h4
                class="font-bold text-sm text-slate-900 dark:text-slate-100 truncate"
              >
                {{ device.display_name }}
              </h4>
              <component
                :is="detectDevicePlatform(device).icon"
                class="w-3.5 h-3.5 flex-shrink-0 opacity-60"
                :class="detectDevicePlatform(device).colorClass"
                :title="detectDevicePlatform(device).label"
              />
            </div>
            <span class="text-[10px] font-medium text-slate-500 flex-shrink-0">
              {{ formatLastSeen(device.last_seen) }}
            </span>
          </div>
          <div
            v-if="device.ip_addresses.length > 0"
            class="text-xs text-primary font-mono mt-0.5 flex items-center gap-1"
          >
            <Wifi class="w-3 h-3 opacity-50" />
            {{ device.ip_addresses.join(", ") }}
          </div>
          <div
            v-else-if="device.addresses.length > 0"
            class="text-xs text-slate-500 font-mono mt-0.5 truncate"
          >
            {{ device.addresses[0] }}
          </div>
        </div>
      </div>
    </div>

    <!-- Local Device Info -->
    <div
      v-if="localNodeId || deviceModel || localHostname"
      class="text-center py-3 space-y-1"
    >
      <p
        class="text-xs text-slate-500 font-medium flex items-center justify-center gap-1.5"
      >
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
      <p class="text-[10px] text-slate-500/60 font-mono">
        ID: <span class="text-primary">{{ localNodeId || "Unknown" }}</span>
      </p>
    </div>

    <!-- System Info Debug Panel -->
    <div class="border-t border-slate-200 dark:border-slate-800 pt-3">
      <Button
        type="button"
        @click="showSystemInfo = !showSystemInfo"
        variant="ghost"
        size="sm"
        class="w-full justify-between px-3 py-2 rounded-xl"
      >
        <span class="text-xs font-semibold text-slate-500"
          >Debug: System Info</span
        >
        <ChevronDown
          class="w-4 h-4 text-slate-500 transition-transform"
          :class="{ 'rotate-180': showSystemInfo }"
        />
      </Button>

      <div
        v-if="showSystemInfo"
        class="mt-3 p-3 bg-slate-100 dark:bg-slate-900 rounded-xl text-xs"
      >
        <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1">
            <div class="font-semibold text-slate-700 dark:text-slate-300">
              hostname
            </div>
            <div class="font-mono text-slate-600 dark:text-slate-500 break-all">
              {{ systemInfo.hostname || "-" }}
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-semibold text-slate-700 dark:text-slate-300">
              platform
            </div>
            <div class="font-mono text-slate-600 dark:text-slate-500">
              {{ systemInfo.platform || "-" }}
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-semibold text-slate-700 dark:text-slate-300">
              arch
            </div>
            <div class="font-mono text-slate-600 dark:text-slate-500">
              {{ systemInfo.arch || "-" }}
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-semibold text-slate-700 dark:text-slate-300">
              type
            </div>
            <div class="font-mono text-slate-600 dark:text-slate-500">
              {{ systemInfo.type || "-" }}
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-semibold text-slate-700 dark:text-slate-300">
              family
            </div>
            <div class="font-mono text-slate-600 dark:text-slate-500">
              {{ systemInfo.family || "-" }}
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-semibold text-slate-700 dark:text-slate-300">
              version
            </div>
            <div class="font-mono text-slate-600 dark:text-slate-500 break-all">
              {{ systemInfo.version || "-" }}
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-semibold text-slate-700 dark:text-slate-300">
              locale
            </div>
            <div class="font-mono text-slate-600 dark:text-slate-500">
              {{ systemInfo.locale || "-" }}
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-semibold text-slate-700 dark:text-slate-300">
              exeExtension
            </div>
            <div class="font-mono text-slate-600 dark:text-slate-500">
              {{ systemInfo.exeExtension || "-" }}
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-semibold text-slate-700 dark:text-slate-300">
              eol
            </div>
            <div class="font-mono text-slate-600 dark:text-slate-500">
              {{ systemInfo.eol || "-" }}
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-semibold text-primary dark:text-primary">
              deviceModel
            </div>
            <div class="font-mono text-primary dark:text-primary break-all">
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
              wifiConnected
            </div>
            <div
              class="font-mono"
              :class="
                isWifiConnected
                  ? 'text-green-600 dark:text-green-500'
                  : 'text-amber-600 dark:text-amber-500'
              "
            >
              {{ isWifiConnected ? "✓ Yes" : "✗ No" }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

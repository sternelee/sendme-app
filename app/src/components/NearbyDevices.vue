<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import {
  start_nearby_discovery,
  get_nearby_devices,
  stop_nearby_discovery,
  get_hostname,
  type NearbyDevice,
} from "@/lib/commands";
import Button from "@/components/ui/button/Button.vue";
import { Label } from "@/components/ui/label";
import { RefreshCw, Wifi, WifiOff, FolderOpen } from "lucide-vue-next";
import { toast } from "vue-sonner";

const emit = defineEmits<{
  selectDevice: [device: NearbyDevice];
}>();

// State
const isScanning = ref(false);
const devices = ref<NearbyDevice[]>([]);
const localNodeId = ref<string>("");
const localHostname = ref<string>("");
const refreshInterval = ref<number | null>(null);
const selectedPath = ref<string>("");

// Computed
const availableDevices = computed(() => {
  return devices.value.filter((d) => d.available);
});

onMounted(async () => {
  await startDiscovery();
  await loadLocalHostname();
});

onUnmounted(async () => {
  await stopDiscovery();
});

async function loadLocalHostname() {
  try {
    localHostname.value = await get_hostname();
  } catch (e) {
    console.error("Failed to get hostname:", e);
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
  if (!selectedPath.value) {
    toast.error("Please select a file first");
    return;
  }
  emit("selectDevice", device);
}

function formatLastSeen(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

async function selectFile() {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
    });
    if (selected && typeof selected === "string") {
      selectedPath.value = selected;
    }
  } catch (e) {
    console.error("Failed to select file:", e);
  }
}

async function selectDirectory() {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: true,
    });
    if (selected && typeof selected === "string") {
      selectedPath.value = selected;
    }
  } catch (e) {
    console.error("Failed to select directory:", e);
  }
}

function getDisplayName(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}
</script>

<template>
  <div class="space-y-6">
    <!-- File Selection -->
    <div class="space-y-3">
      <Label class="text-sm font-semibold opacity-70 ml-1"
        >Select File to Send</Label
      >
      <div
        class="p-4 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl hover:border-primary/50 hover:bg-white/5 transition-all cursor-pointer"
        @click="selectFile"
      >
        <div v-if="!selectedPath" class="text-center">
          <FolderOpen
            class="w-8 h-8 mx-auto mb-2 text-primary opacity-50"
          />
          <p class="text-sm text-slate-500 dark:text-slate-400">
            Click to select a file or directory
          </p>
        </div>
        <div v-else class="text-center">
          <p class="font-semibold text-primary">
            {{ getDisplayName(selectedPath) }}
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-500 mt-1 truncate">
            {{ selectedPath }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button
          type="button"
          @click="selectFile"
          :disabled="isScanning"
          variant="secondary"
          class="h-12 rounded-xl"
        >
          <FolderOpen class="h-4 w-4 mr-2" />
          Select File
        </Button>
        <Button
          type="button"
          @click="selectDirectory"
          :disabled="isScanning"
          variant="secondary"
          class="h-12 rounded-xl"
        >
          <FolderOpen class="h-4 w-4 mr-2" />
          Select Directory
        </Button>
      </div>
    </div>

    <!-- Discovery Status -->
    <div class="flex items-center justify-between p-4 glass-card rounded-2xl">
      <div class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-xl flex items-center justify-center"
          :class="
            isScanning
              ? 'bg-blue-500/10 text-blue-500'
              : 'bg-slate-500/10 text-slate-500'
          "
        >
          <Wifi v-if="isScanning" class="w-5 h-5 animate-pulse" />
          <WifiOff v-else class="w-5 h-5" />
        </div>
        <div>
          <div class="font-semibold text-sm">
            {{ isScanning ? "Scanning for devices..." : "Discovery stopped" }}
          </div>
          <div class="text-xs text-slate-500">
            {{ availableDevices.length }} device(s) found
          </div>
        </div>
      </div>
      <Button
        @click="refreshDevices"
        :disabled="!isScanning"
        variant="ghost"
        size="sm"
        class="rounded-xl"
      >
        <RefreshCw
          class="w-4 h-4"
          :class="{ 'animate-spin': isScanning }"
        />
      </Button>
    </div>

    <!-- Device List -->
    <div class="space-y-3">
      <Label class="text-sm font-semibold opacity-70 ml-1"
        >Nearby Devices</Label
      >

      <div v-if="availableDevices.length === 0" class="text-center py-8">
        <div
          class="w-16 h-16 bg-slate-500/5 rounded-full flex items-center justify-center mx-auto mb-3"
        >
          <WifiOff class="w-6 h-6 opacity-20" />
        </div>
        <p class="text-sm text-slate-500 font-medium">
          {{ isScanning ? "Scanning for devices..." : "No devices found" }}
        </p>
        <p class="text-xs text-slate-500/60 mt-1">
          Make sure both devices are on the same network
        </p>
      </div>

      <div
        v-for="device in availableDevices"
        :key="device.node_id"
        class="p-4 glass-card rounded-2xl hover:scale-[1.01] transition-all duration-300 cursor-pointer group"
        @click="handleSelectDevice(device)"
      >
        <div class="flex items-center gap-4">
          <div
            class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-green-500/10 text-green-500"
          >
            <Wifi class="w-6 h-6" />
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <h4 class="font-bold text-slate-900 dark:text-slate-100 truncate">
                {{ device.display_name }}
              </h4>
              <span class="text-[10px] font-medium text-slate-500 flex-shrink-0 ml-2">
                {{ formatLastSeen(device.last_seen) }}
              </span>
            </div>
            <div
              v-if="device.ip_addresses.length > 0"
              class="text-xs text-primary font-mono mt-1 flex items-center gap-1"
            >
              <Wifi class="w-3 h-3 opacity-50" />
              {{ device.ip_addresses.join(", ") }}
            </div>
            <div
              v-else-if="device.addresses.length > 0"
              class="text-xs text-slate-500 font-mono mt-1 truncate"
            >
              {{ device.addresses[0] }}
            </div>
            <div
              v-if="device.name && device.name !== device.display_name"
              class="text-[10px] text-slate-500 mt-1 truncate"
              :title="device.name"
            >
              {{ device.name }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Local Device Info -->
    <div v-if="localNodeId || localHostname" class="text-center py-4 space-y-1">
      <p class="text-xs text-slate-500 font-medium">
        Your Device:
        <span class="text-slate-700 dark:text-slate-300 font-semibold">{{ localHostname || 'Unknown' }}</span>
      </p>
      <p class="text-[10px] text-slate-500/60 font-mono">
        ID: <span class="text-primary">{{ localNodeId || 'Unknown' }}</span>
      </p>
    </div>
  </div>
</template>

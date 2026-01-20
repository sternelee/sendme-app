<script setup lang="ts">
import { ref } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Download,
  X,
  FileText,
  FileImage,
  FileArchive,
  FileCode,
  Smartphone,
  Laptop,
  Monitor,
} from "lucide-vue-next";

interface TicketRequest {
  id: string;
  sender_device: {
    name: string;
    display_name: string;
    platform?: string;
  };
  transfer_info: {
    file_count: number;
    total_size: number;
    names: string[];
  };
  ticket: string;
}

interface Props {
  open: boolean;
  request?: TicketRequest | null;
}

const emit = defineEmits<{
  accept: [ticket: string];
  reject: [id: string];
  close: [];
}>();

const props = withDefaults(defineProps<Props>(), {
  open: false,
  request: null,
});

const isAccepting = ref(false);

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const getFileIcon = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext!))
    return FileImage;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext!)) return FileArchive;
  if (["ts", "js", "py", "rs", "go", "html", "css", "vue"].includes(ext!))
    return FileCode;
  return FileText;
};

const detectDevicePlatform = (device: { display_name: string }) => {
  const name = device.display_name.toLowerCase();

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

  if (
    name.includes("macbook") ||
    name.includes("imac") ||
    name.includes("mac mini") ||
    name.includes(".local")
  ) {
    return {
      icon: Laptop,
      label: "macOS",
      colorClass: "text-slate-700 dark:text-slate-300",
    };
  }

  if (
    name.includes("android") ||
    name.includes("pixel") ||
    name.includes("samsung")
  ) {
    return {
      icon: Smartphone,
      label: "Android",
      colorClass: "text-green-600 dark:text-green-500",
    };
  }

  if (
    name.includes("windows") ||
    name.includes("desktop-") ||
    name.includes("pc-")
  ) {
    return {
      icon: Laptop,
      label: "Windows",
      colorClass: "text-blue-600 dark:text-blue-500",
    };
  }

  if (
    name.includes("linux") ||
    name.includes("ubuntu") ||
    name.includes("debian")
  ) {
    return {
      icon: Laptop,
      label: "Linux",
      colorClass: "text-orange-600 dark:text-orange-500",
    };
  }

  return {
    icon: Monitor,
    label: "Device",
    colorClass: "text-slate-600 dark:text-slate-400",
  };
};

const handleAccept = async () => {
  if (!props.request) return;

  isAccepting.value = true;
  try {
    emit("accept", props.request.ticket);
  } finally {
    isAccepting.value = false;
  }
};

const handleReject = () => {
  if (!props.request) return;
  emit("reject", props.request.id);
};

const handleClose = () => {
  emit("close");
};
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent class="sm:max-w-md glass-card rounded-2xl border-white/10">
      <DialogHeader class="text-center">
        <div class="flex items-center justify-center mb-2">
          <div
            class="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center"
          >
            <component
              :is="
                request
                  ? detectDevicePlatform(request.sender_device).icon
                  : Monitor
              "
              class="w-6 h-6"
            />
          </div>
        </div>
        <DialogTitle class="text-xl font-bold"> Incoming Transfer </DialogTitle>
        <DialogDescription class="text-sm text-slate-600 dark:text-slate-400">
          {{ request?.sender_device.display_name || "Unknown device" }} wants to
          send you files
        </DialogDescription>
      </DialogHeader>

      <div v-if="request" class="space-y-4 py-4">
        <!-- Device Info -->
        <div
          class="flex items-center gap-3 p-3 bg-black/5 dark:bg-white/5 rounded-xl"
        >
          <component
            :is="detectDevicePlatform(request.sender_device).icon"
            :class="detectDevicePlatform(request.sender_device).colorClass"
            class="w-5 h-5"
          />
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm truncate">
              {{ request.sender_device.display_name }}
            </div>
            <div class="text-xs text-slate-500">
              {{ detectDevicePlatform(request.sender_device).label }}
            </div>
          </div>
        </div>

        <!-- Transfer Info -->
        <div class="space-y-3 p-3 bg-black/5 dark:bg-white/5 rounded-xl">
          <div class="flex items-center justify-between text-sm">
            <span class="text-slate-600 dark:text-slate-400">Files:</span>
            <span class="font-semibold">{{
              request.transfer_info.file_count
            }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-slate-600 dark:text-slate-400">Total size:</span>
            <span class="font-semibold">{{
              formatFileSize(request.transfer_info.total_size)
            }}</span>
          </div>

          <!-- File List -->
          <div
            v-if="request.transfer_info.names.length > 0"
            class="pt-2 border-t border-white/5"
          >
            <div class="text-xs text-slate-600 dark:text-slate-400 mb-2">
              Contents:
            </div>
            <div class="space-y-1 max-h-32 overflow-y-auto">
              <div
                v-for="(name, i) in request.transfer_info.names.slice(0, 5)"
                :key="i"
                class="flex items-center gap-2 text-xs"
              >
                <component :is="getFileIcon(name)" class="w-3 h-3 opacity-50" />
                <span class="font-mono truncate">{{ name }}</span>
              </div>
              <div
                v-if="request.transfer_info.names.length > 5"
                class="text-xs text-slate-500 pl-5"
              >
                +{{ request.transfer_info.names.length - 5 }} more files
              </div>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="flex gap-2 pt-4">
        <Button
          variant="outline"
          @click="handleReject"
          :disabled="isAccepting"
          class="flex-1 h-12 rounded-xl"
        >
          <X class="w-4 h-4 mr-2" />
          Decline
        </Button>
        <Button
          @click="handleAccept"
          :disabled="isAccepting"
          class="flex-1 h-12 rounded-xl bg-primary hover:bg-primary/90"
        >
          <Download v-if="!isAccepting" class="w-4 h-4 mr-2" />
          <div
            v-else
            class="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"
          ></div>
          {{ isAccepting ? "Accepting..." : "Accept" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>


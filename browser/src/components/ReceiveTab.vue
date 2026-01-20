<script setup lang="ts">
import { ref } from "vue";
import { Button } from "./ui/button";
import { Download, Check, AlertCircle } from "lucide-vue-next";
import { receiveFile, downloadFile } from "@/lib/commands";

const ticket = ref<string>("");
const isReceiving = ref(false);
const receivedFile = ref<{ filename: string; data: Uint8Array } | null>(null);
const error = ref<string>("");

async function handleReceive() {
  if (!ticket.value.trim()) return;

  isReceiving.value = true;
  error.value = "";
  receivedFile.value = null;

  try {
    const result = await receiveFile(ticket.value.trim());
    receivedFile.value = result;
  } catch (err) {
    error.value = (err as Error).message || "Failed to receive file";
  } finally {
    isReceiving.value = false;
  }
}

function downloadReceivedFile() {
  if (!receivedFile.value) return;
  downloadFile(receivedFile.value.data, receivedFile.value.filename);
}

function pasteTicket() {
  navigator.clipboard.readText().then((text) => {
    ticket.value = text;
  });
}

function formatFileSize(bytes: Uint8Array): string {
  const size = bytes.length;
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <h2 class="text-2xl font-bold text-white mb-2">Receive Files</h2>
      <p class="text-white/60">Enter a ticket to download files</p>
    </div>

    <div class="space-y-4">
      <div>
        <label class="text-sm text-white/80 mb-2 block">Ticket</label>
        <div class="flex gap-2">
          <input
            v-model="ticket"
            type="text"
            placeholder="Paste ticket here..."
            class="flex-1 bg-black/30 border border-white/10 rounded-lg px-2 py-2 text-white placeholder:text-white/40 focus:outline-none focus:border-purple-400"
            :disabled="isReceiving"
          />
          <Button
            variant="outline"
            class="shrink-0 min-w-10"
            size="icon"
            @click="pasteTicket"
          >
            📋
          </Button>
        </div>
      </div>

      <Button
        size="lg"
        class="w-full h-12 text-base"
        :disabled="!ticket.trim() || isReceiving"
        @click="handleReceive"
      >
        <Download v-if="!isReceiving" :size="20" class="mr-2" />
        {{ isReceiving ? "Connecting..." : "Download File" }}
      </Button>
    </div>

    <div
      v-if="error"
      class="rounded-xl bg-red-500/10 border border-red-500/20 p-6"
    >
      <div class="flex items-center gap-2 text-red-400 mb-2">
        <AlertCircle :size="20" />
        <span class="font-medium">Error</span>
      </div>
      <p class="text-white/70 text-sm">{{ error }}</p>
    </div>

    <div
      v-if="receivedFile"
      class="rounded-xl bg-white/5 border border-white/10 p-6 space-y-4"
    >
      <div class="flex items-center gap-2 text-green-400">
        <Check :size="20" />
        <span class="font-medium">File Received</span>
      </div>

      <div class="bg-black/30 rounded-lg p-4">
        <div class="font-medium text-white truncate">
          {{ receivedFile.filename }}
        </div>
        <div class="text-sm text-white/60 mt-1">
          {{ formatFileSize(receivedFile.data) }}
        </div>
      </div>

      <Button size="lg" class="w-full" @click="downloadReceivedFile">
        <Download :size="20" class="mr-2" />
        Save to Device
      </Button>
    </div>
  </div>
</template>

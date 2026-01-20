<script setup lang="ts">
import { ref } from "vue";
import { Button } from "./ui/button";
import { Upload, Link as LinkIcon, Check } from "lucide-vue-next";
import { sendFile } from "@/lib/commands";

const file = ref<File | null>(null);
const ticket = ref<string>("");
const isSending = ref(false);
const isDragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

async function handleSend() {
  if (!file.value) return;

  isSending.value = true;
  try {
    ticket.value = await sendFile(file.value);
  } catch (error) {
    console.error("Send failed:", error);
    alert("Failed to send file: " + (error as Error).message);
  } finally {
    isSending.value = false;
  }
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    file.value = target.files[0];
    ticket.value = "";
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault();
  isDragging.value = false;
  if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
    file.value = event.dataTransfer.files[0];
    ticket.value = "";
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault();
  isDragging.value = true;
}

function handleDragLeave() {
  isDragging.value = false;
}

function copyTicket() {
  navigator.clipboard.writeText(ticket.value);
}

function selectFile() {
  fileInput.value?.click();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <h2 class="text-2xl font-bold text-white mb-2">Send Files</h2>
      <p class="text-white/60">Share files securely over P2P</p>
    </div>

    <div
      class="border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer"
      :class="
        isDragging
          ? 'border-purple-400 bg-purple-500/10'
          : 'border-white/20 bg-white/5 hover:border-white/30 hover:bg-white/10'
      "
      @drop="handleDrop"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @click="selectFile"
    >
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        @change="handleFileSelect"
      />

      <Upload v-if="!file" :size="48" class="mx-auto mb-4 text-white/40" />

      <Check v-else :size="48" class="mx-auto mb-4 text-green-400" />

      <div v-if="!file" class="text-white/80">
        Drop a file here or click to browse
      </div>
      <div v-else class="text-white">
        <div class="font-medium truncate">{{ file.name }}</div>
        <div class="text-sm text-white/60 mt-1">
          {{ formatFileSize(file.size) }}
        </div>
      </div>

      <input
        ref="fileInput"
        type="file"
        class="hidden"
        @change="handleFileSelect"
      />
    </div>

    <Button
      v-if="file && !ticket"
      size="lg"
      class="w-full h-12 text-base"
      :disabled="isSending"
      @click="handleSend"
    >
      {{ isSending ? "Creating Ticket..." : "Create Ticket" }}
    </Button>

    <div
      v-if="ticket"
      class="rounded-xl bg-white/5 border border-white/10 p-6 space-y-4"
    >
      <div class="flex items-center gap-2 text-green-400">
        <Check :size="20" />
        <span class="font-medium">Ready to Share</span>
      </div>

      <div>
        <label class="text-sm text-white/60 mb-2 block">Share Ticket</label>
        <div class="flex gap-2">
          <input
            :value="ticket"
            readonly
            class="flex-1 bg-black/30 border border-white/10 rounded-lg px-4 py-3 text-white text-sm font-mono"
          />
          <Button variant="outline" size="icon" @click="copyTicket">
            <LinkIcon :size="18" />
          </Button>
        </div>
      </div>

      <p class="text-sm text-white/50">
        Share this ticket with the recipient. They can use it to download your
        file.
      </p>
    </div>
  </div>
</template>

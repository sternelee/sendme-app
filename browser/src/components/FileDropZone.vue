<script setup lang="ts">
import { ref, computed } from "vue";
import { Upload } from "lucide-vue-next";

const props = defineProps<{
  isDragging: boolean;
}>();

const emit = defineEmits<{
  (e: "drop", file: File): void;
  (e: "dragOver"): void;
  (e: "dragLeave"): void;
}>();

const dropZoneClass = computed(() => {
  return props.isDragging
    ? "border-purple-400 bg-purple-500/10"
    : "border-white/20 bg-white/5 hover:border-white/30 hover:bg-white/10";
});

function handleDrop(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
    emit("drop", event.dataTransfer.files[0]);
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault();
  emit("dragOver");
}

function handleDragLeave() {
  emit("dragLeave");
}
</script>

<template>
  <div
    class="border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer"
    :class="dropZoneClass"
    @drop="handleDrop"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
  >
    <Upload :size="48" class="mx-auto mb-4 text-white/40" />

    <div class="text-white/80">
      <slot />
    </div>
  </div>
</template>

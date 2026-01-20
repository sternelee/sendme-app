<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import SendTab from "./components/SendTab.vue";
import ReceiveTab from "./components/ReceiveTab.vue";
import { initWasm } from "./lib/commands";
import { Sparkles } from "lucide-vue-next";

const activeTab = ref("send");
const isInitializing = ref(true);

onMounted(async () => {
  try {
    await initWasm();
  } catch (error) {
    console.error("Failed to initialize WASM:", error);
  } finally {
    isInitializing.value = false;
  }
});
</script>

<template>
  <div
    class="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900"
  >
    <!-- Background effects -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none">
      <div
        class="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl"
      />
      <div
        class="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl"
      />
      <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-pink-500/10 rounded-full blur-3xl"
      />
    </div>

    <!-- Main content -->
    <div
      class="relative z-10 container mx-auto px-4 py-8 min-h-screen flex flex-col items-center justify-center"
    >
      <!-- Logo/Title -->
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3 mb-4">
          <div
            class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center"
          >
            <Sparkles :size="24" class="text-white" />
          </div>
          <h1 class="text-4xl font-bold text-white">Sendme</h1>
        </div>
        <p class="text-white/60">Secure P2P file transfer in your browser</p>
      </div>

      <!-- Loading state -->
      <div
        v-if="isInitializing"
        class="w-full max-w-lg bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 text-center"
      >
        <div
          class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mb-4"
        />
        <p class="text-white/80">Initializing...</p>
      </div>

      <!-- Main card -->
      <div
        v-else
        class="w-full max-w-lg bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6"
      >
        <Tabs v-model="activeTab" class="w-full">
          <TabsList class="w-full mb-6">
            <TabsTrigger value="send" class="flex-1 text-white">
              Send
            </TabsTrigger>
            <TabsTrigger value="receive" class="flex-1 text-white">
              Receive
            </TabsTrigger>
          </TabsList>

          <TabsContent value="send">
            <SendTab />
          </TabsContent>

          <TabsContent value="receive">
            <ReceiveTab />
          </TabsContent>
        </Tabs>
      </div>

      <!-- Footer -->
      <div class="mt-8 text-center text-white/40 text-sm">
        <p>
          Powered by
          <a
            href="https://iroh.computer"
            target="_blank"
            class="text-purple-400 hover:text-purple-300"
            >iroh</a
          >
          networking
        </p>
      </div>
    </div>
  </div>
</template>

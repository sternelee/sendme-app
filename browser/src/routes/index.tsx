import { createSignal, onMount, Show } from "solid-js";
import { initWasm } from "../lib/commands";
import { useAuth } from "../lib/contexts/user-better-auth";
import SendTab from "../components/sendme/SendTab";
import ReceiveTab from "../components/sendme/ReceiveTab";
import AuthModal from "../components/auth/AuthModal";
import {
  TbOutlineSparkles,
  TbOutlineUpload,
  TbOutlineDownload,
  TbOutlineUser,
  TbOutlineLogout,
} from "solid-icons/tb";

export default function Home() {
  const [activeTab, setActiveTab] = createSignal<"send" | "receive">("send");
  const [isInitializing, setIsInitializing] = createSignal(true);

  const auth = useAuth();

  onMount(async () => {
    try {
      await initWasm();
    } catch (error) {
      console.error("Failed to initialize WASM:", error);
    } finally {
      setIsInitializing(false);
    }
  });

  const handleLogout = async () => {
    await auth.logout();
  };

  // Show auth modal if not authenticated
  if (!auth.isLoading() && !auth.isAuthenticated()) {
    return <AuthModal />;
  }

  return (
    <div class="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900">
      {/* Background effects */}
      <div class="fixed inset-0 overflow-hidden pointer-events-none">
        <div class="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />
        <div class="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl" />
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-pink-500/10 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header class="relative z-10 border-b border-white/10 backdrop-blur-xl bg-black/20">
        <div class="container mx-auto px-4 py-4 flex items-center justify-between">
          <a
            class="flex items-center gap-3 text-white hover:opacity-80 transition-opacity"
            href="https://iroh.computer"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center">
              <TbOutlineSparkles size={20} class="text-white" />
            </div>
            <span class="text-xl font-bold">Sendme</span>
          </a>

          <Show when={auth.isAuthenticated() && auth.user()}>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-sm">
                <TbOutlineUser size={16} class="text-white/70" />
                <span class="text-sm text-white">{auth.user()?.name}</span>
              </div>
              <button
                onClick={handleLogout}
                class="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                title="Logout"
              >
                <TbOutlineLogout size={18} class="text-white/70" />
              </button>
            </div>
          </Show>
        </div>
      </header>

      {/* Main content */}
      <main class="relative z-10 container mx-auto px-4 py-8 min-h-[calc(100vh-80px)] flex flex-col items-center justify-center">
        {/* Loading state */}
        {isInitializing() && (
          <div class="glass rounded-2xl p-8 text-center">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mb-4" />
            <p class="text-white/80">Initializing...</p>
          </div>
        )}

        {/* Main card */}
        {!isInitializing() && (
          <div class="w-full max-w-lg">
            {/* Tabs */}
            <div class="glass rounded-2xl p-1.5 mb-6 flex gap-1">
              <button
                onClick={() => setActiveTab("send")}
                class={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                  activeTab() === "send"
                    ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                <TbOutlineUpload size={18} />
                Send
              </button>
              <button
                onClick={() => setActiveTab("receive")}
                class={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                  activeTab() === "receive"
                    ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                <TbOutlineDownload size={18} />
                Receive
              </button>
            </div>

            {/* Content card */}
            <div class="glass rounded-2xl p-6">
              {activeTab() === "send" ? <SendTab /> : <ReceiveTab />}
            </div>
          </div>
        )}

        {/* Footer */}
        <footer class="relative z-10 mt-8 text-center text-sm text-white/40">
          <p>
            Secure P2P file transfer powered by{" "}
            <a
              href="https://iroh.computer"
              target="_blank"
              rel="noopener noreferrer"
              class="text-purple-400 hover:text-purple-300 transition-colors"
            >
              iroh
            </a>{" "}
            networking
          </p>
        </footer>
      </main>
    </div>
  );
}

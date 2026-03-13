import { createSignal, onMount, Show, Switch, Match } from "solid-js";
import { initWasm } from "../../lib/commands";
import SendTab from "../../components/sendme/SendTab";
import ReceiveTab from "../../components/sendme/ReceiveTab";
import TextTab from "../../components/sendme/TextTab";
import DeviceListModal from "../../components/devices/DeviceListModal";
import { Motion, Presence } from "solid-motionone";
import {
  TbOutlineSparkles,
  TbOutlineUpload,
  TbOutlineDownload,
  TbOutlineDevices,
  TbOutlineLogout,
  TbOutlineSun,
  TbOutlineMoon,
  TbOutlineMessage,
  TbOutlineHistory,
  TbOutlineSettings,
} from "solid-icons/tb";

type Theme = "light" | "dark";
type ActiveTab = "send" | "receive" | "text" | "history" | "settings";

export default function AppPage() {
  const [activeTab, setActiveTab] = createSignal<ActiveTab>("send");
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [mousePos, setMousePos] = createSignal({ x: 0, y: 0 });
  const [isDeviceModalOpen, setIsDeviceModalOpen] = createSignal(false);
  const [theme, setTheme] = createSignal<Theme>("dark");

  onMount(async () => {
    try {
      await initWasm();
    } catch (error) {
      console.error("Failed to initialize WASM:", error);
    } finally {
      setIsInitializing(false);
    }

    // Load theme from localStorage
    const savedTheme = localStorage.getItem("theme") as Theme | null;
    if (savedTheme) {
      setTheme(savedTheme);
      applyTheme(savedTheme);
    }

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  });

  function applyTheme(newTheme: Theme) {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(newTheme);
  }

  function toggleTheme() {
    const newTheme = theme() === "dark" ? "light" : "dark";
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  }

  return (
    <div class="min-h-screen bg-animate text-gray-900 dark:text-white selection:bg-purple-500/30">
      {/* Dynamic Background */}
      <div class="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <Motion.div
          animate={{
            x: mousePos().x * 0.05,
            y: mousePos().y * 0.05,
          }}
          class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/20 dark:bg-purple-600/20 rounded-full blur-[120px]"
        />
        <Motion.div
          animate={{
            x: mousePos().x * -0.03,
            y: mousePos().y * -0.03,
          }}
          class="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/20 dark:bg-indigo-600/20 rounded-full blur-[120px]"
        />
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_center,transparent_0%,rgba(18,14,38,0.4)_100%)]" />
      </div>

      {/* Header */}
      <header class="relative z-20 border-b border-gray-200 dark:border-white/5 backdrop-blur-md bg-white/80 dark:bg-black/10">
        <div class="container mx-auto px-6 py-4 flex items-center justify-between">
          <Motion.a
            hover={{ scale: 1.05 }}
            press={{ scale: 0.95 }}
            class="flex items-center gap-3 group"
            href="/"
          >
            <div class="w-10 h-10 rounded-xl bg-linear-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-all">
              <TbOutlineSparkles size={22} class="text-white" />
            </div>
            <span class="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-white/60">
              Sendme
            </span>
          </Motion.a>

          <div class="flex items-center gap-2">
            {/* Theme Toggle */}
            <Motion.button
              hover={{ scale: 1.05 }}
              press={{ scale: 0.95 }}
              onClick={toggleTheme}
              class="p-2.5 rounded-xl bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white transition-colors"
              title={`Current theme: ${theme()}`}
            >
              <Show
                when={theme() === "dark"}
                fallback={<TbOutlineMoon size={20} />}
              >
                <TbOutlineSun size={20} />
              </Show>
            </Motion.button>

            <Show when={false /* auth.isAuthenticated() && auth.user() */}>
              <div class="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10">
                <div class="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span class="text-xs font-medium text-gray-700 dark:text-white/80">
                  User
                </span>
              </div>
              <Motion.button
                hover={{ scale: 1.05, backgroundColor: "rgba(0, 0, 0, 0.1)" }}
                press={{ scale: 0.95 }}
                onClick={() => setIsDeviceModalOpen(true)}
                class="p-2.5 rounded-xl bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white transition-colors"
                title="Devices"
              >
                <TbOutlineDevices size={20} />
              </Motion.button>
              <Motion.button
                hover={{ scale: 1.05, backgroundColor: "rgba(0, 0, 0, 0.1)" }}
                press={{ scale: 0.95 }}
                class="p-2.5 rounded-xl bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white transition-colors"
                title="Logout"
              >
                <TbOutlineLogout size={20} />
              </Motion.button>
            </Show>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main class="relative z-10 container mx-auto px-4 py-8 min-h-[calc(100vh-80px)] flex flex-col items-center">
        <div class="w-full max-w-2xl space-y-8">
          <Presence>
            {isInitializing() ? (
              <Motion.div
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.2 }}
                class="glass-liquid glass-frost rounded-3xl border border-gray-200 dark:border-white/10 p-8 text-center"
              >
                <TbOutlineSparkles
                  class="mx-auto mb-4 text-purple-400 animate-spin"
                  size={40}
                />
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Initializing
                </h3>
                <p class="text-sm text-gray-500 dark:text-white/50">
                  Preparing secure P2P node...
                </p>
              </Motion.div>
            ) : (
              <Motion.div
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                class="glass-liquid glass-frost rounded-3xl border border-gray-200 dark:border-white/10 shadow-2xl"
              >
                <div class="p-8">
                  {/* Single-level Tabs */}
                  <div class="relative mb-8 flex gap-1 overflow-hidden p-1.5 bg-gray-100 dark:bg-white/5 rounded-xl">
                      <Motion.div
                        animate={{
                          left:
                            activeTab() === "send"
                              ? "2px"
                              : activeTab() === "receive"
                                ? "calc(20% + 1px)"
                                : activeTab() === "text"
                                  ? "calc(40% + 1px)"
                                  : activeTab() === "history"
                                    ? "calc(60% + 1px)"
                                    : "calc(80% + 1px)",
                          width: "calc(20% - 4px)",
                        }}
                        transition={{ duration: 0.2, easing: "ease-out" }}
                        class="absolute top-1.5 bottom-1.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 shadow-lg shadow-purple-500/20"
                      />
                      <button
                        onClick={() => setActiveTab("send")}
                        class={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-3.5 font-semibold transition-all text-xs ${
                          activeTab() === "send"
                            ? "text-white"
                            : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80"
                        }`}
                      >
                        <TbOutlineUpload size={18} />
                        Send
                      </button>
                      <button
                        onClick={() => setActiveTab("receive")}
                        class={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-3.5 font-semibold transition-all text-xs ${
                          activeTab() === "receive"
                            ? "text-white"
                            : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80"
                        }`}
                      >
                        <TbOutlineDownload size={18} />
                        Receive
                      </button>
                      <button
                        onClick={() => setActiveTab("text")}
                        class={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-3.5 font-semibold transition-all text-xs ${
                          activeTab() === "text"
                            ? "text-white"
                            : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80"
                        }`}
                      >
                        <TbOutlineMessage size={18} />
                        Text
                      </button>
                      <button
                        onClick={() => setActiveTab("history")}
                        class={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-3.5 font-semibold transition-all text-xs ${
                          activeTab() === "history"
                            ? "text-white"
                            : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80"
                        }`}
                      >
                        <TbOutlineHistory size={18} />
                        History
                      </button>
                      <button
                        onClick={() => setActiveTab("settings")}
                        class={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-3.5 font-semibold transition-all text-xs ${
                          activeTab() === "settings"
                            ? "text-white"
                            : "text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80"
                        }`}
                      >
                        <TbOutlineSettings size={18} />
                        Settings
                      </button>
                    </div>

                  {/* Tab Content */}
                  <Presence exitBeforeEnter>
                    <Switch fallback={null}>
                      <Match when={activeTab() === "send"}>
                        <Motion.div
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2, easing: "ease-out" }}
                        >
                          <SendTab />
                        </Motion.div>
                      </Match>
                      <Match when={activeTab() === "receive"}>
                        <Motion.div
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2, easing: "ease-out" }}
                        >
                          <ReceiveTab isActive={true} />
                        </Motion.div>
                      </Match>
                      <Match when={activeTab() === "text"}>
                        <Motion.div
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2, easing: "ease-out" }}
                        >
                          <TextTab />
                        </Motion.div>
                      </Match>
                      <Match when={activeTab() === "history"}>
                        <Motion.div
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2, easing: "ease-out" }}
                        >
                          <div class="py-8 text-center">
                            <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center justify-center">
                              <TbOutlineHistory
                                size={32}
                                class="text-gray-400 dark:text-white/20"
                              />
                            </div>
                            <p class="text-gray-500 dark:text-white/40">
                              No transfers yet
                            </p>
                            <p class="text-sm text-gray-400 dark:text-white/30 mt-1">
                              Your shared and received files will appear here
                            </p>
                          </div>
                        </Motion.div>
                      </Match>
                      <Match when={activeTab() === "settings"}>
                        <Motion.div
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2, easing: "ease-out" }}
                        >
                          <div class="space-y-6 py-4">
                            <div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-2xl">
                              <div>
                                <p class="font-medium text-gray-900 dark:text-white">
                                  Theme
                                </p>
                                <p class="text-sm text-gray-500 dark:text-white/40">
                                  Choose appearance
                                </p>
                              </div>
                              <div class="flex gap-1 p-1 bg-gray-200 dark:bg-white/5 rounded-lg">
                                <button
                                  onClick={() => {
                                    setTheme("light");
                                    applyTheme("light");
                                    localStorage.setItem("theme", "light");
                                  }}
                                  class={`px-3 py-1.5 rounded-md text-sm transition-all ${
                                    theme() === "light"
                                      ? "bg-white dark:bg-white/10 text-purple-600 dark:text-purple-400 shadow-sm"
                                      : "text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white"
                                  }`}
                                >
                                  Light
                                </button>
                                <button
                                  onClick={() => {
                                    setTheme("dark");
                                    applyTheme("dark");
                                    localStorage.setItem("theme", "dark");
                                  }}
                                  class={`px-3 py-1.5 rounded-md text-sm transition-all ${
                                    theme() === "dark"
                                      ? "bg-white dark:bg-white/10 text-purple-600 dark:text-purple-400 shadow-sm"
                                      : "text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white"
                                  }`}
                                >
                                  Dark
                                </button>
                              </div>
                            </div>
                          </div>
                        </Motion.div>
                      </Match>
                    </Switch>
                  </Presence>
                </div>
              </Motion.div>
            )}
          </Presence>
        </div>

        {/* Footer */}
        <Motion.footer
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          class="relative z-10 mt-auto py-12 text-center"
        >
          <div class="flex items-center justify-center gap-4 mb-4">
            <div class="h-px w-8 bg-gray-300 dark:bg-white/10" />
            <span class="text-[10px] uppercase tracking-[0.2em] text-gray-500 dark:text-white/30 font-bold">
              Secure Protocol
            </span>
            <div class="h-px w-8 bg-gray-300 dark:bg-white/10" />
          </div>
          <p class="text-sm text-gray-500 dark:text-white/40">
            Powered by{" "}
            <a
              href="https://iroh.computer"
              target="_blank"
              rel="noopener noreferrer"
              class="text-purple-500 dark:text-purple-400/80 hover:text-purple-400 transition-colors font-medium underline underline-offset-4 decoration-purple-500/30"
            >
              iroh.computer
            </a>
          </p>
        </Motion.footer>
      </main>

      {/* Device List Modal */}
      <Show when={false /* auth.isAuthenticated() */}>
        <DeviceListModal
          isOpen={isDeviceModalOpen()}
          onClose={() => setIsDeviceModalOpen(false)}
        />
      </Show>
    </div>
  );
}

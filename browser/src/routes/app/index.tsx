import { createSignal, onMount, Show, Switch, Match } from "solid-js";
import { initWasm } from "../../lib/commands";
import { useAuth } from "../../lib/contexts/user-better-auth";
import SendTab from "../../components/pisend/SendTab";
import ReceiveTab from "../../components/pisend/ReceiveTab";
import DeviceListModal from "../../components/devices/DeviceListModal";
import { Motion, Presence } from "solid-motionone";
import {
  TbOutlineSparkles,
  TbOutlineUpload,
  TbOutlineDownload,
  TbOutlineDevices,
  TbOutlineLogout,
} from "solid-icons/tb";

export default function AppPage() {
  const [activeTab, setActiveTab] = createSignal<"send" | "receive">("send");
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [mousePos, setMousePos] = createSignal({ x: 0, y: 0 });
  const [isDeviceModalOpen, setIsDeviceModalOpen] = createSignal(false);

  const auth = useAuth();

  onMount(async () => {
    try {
      await initWasm();
    } catch (error) {
      console.error("Failed to initialize WASM:", error);
    } finally {
      setIsInitializing(false);
    }

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  });

  const handleLogout = async () => {
    await auth.logout();
  };

  return (
    <div class="min-h-screen bg-animate text-white selection:bg-purple-500/30">
      {/* Dynamic Background */}
      <div class="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <Motion.div
          animate={{
            x: mousePos().x * 0.05,
            y: mousePos().y * 0.05,
          }}
          class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px]"
        />
        <Motion.div
          animate={{
            x: mousePos().x * -0.03,
            y: mousePos().y * -0.03,
          }}
          class="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/20 rounded-full blur-[120px]"
        />
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_center,transparent_0%,rgba(18,14,38,0.4)_100%)]" />
      </div>

      {/* Header */}
      <header class="relative z-20 border-b border-white/5 backdrop-blur-md bg-black/10">
        <div class="container mx-auto px-6 py-4 flex items-center justify-between">
          <Motion.a
            hover={{ scale: 1.05 }}
            press={{ scale: 0.95 }}
            class="flex items-center gap-3 group"
            href="/"
          >
            <div class="w-10 h-10 rounded-xl bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-all">
              <TbOutlineSparkles size={22} class="text-white" />
            </div>
            <span class="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
              PiSend
            </span>
          </Motion.a>

          <Show when={auth.isAuthenticated() && auth.user()}>
            <div class="flex items-center gap-4">
              <div class="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                <div class="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span class="text-xs font-medium text-white/80">
                  {auth.user()?.name}
                </span>
              </div>
              <Motion.button
                hover={{
                  scale: 1.05,
                  backgroundColor: "rgba(255, 255, 255, 0.15)",
                }}
                press={{ scale: 0.95 }}
                onClick={() => setIsDeviceModalOpen(true)}
                class="p-2.5 rounded-xl bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors"
                title="Devices"
              >
                <TbOutlineDevices size={20} />
              </Motion.button>
              <Motion.button
                hover={{
                  scale: 1.05,
                  backgroundColor: "rgba(255, 255, 255, 0.15)",
                }}
                press={{ scale: 0.95 }}
                onClick={handleLogout}
                class="p-2.5 rounded-xl bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors"
                title="Logout"
              >
                <TbOutlineLogout size={20} />
              </Motion.button>
            </div>
          </Show>
        </div>
      </header>

      {/* Main content */}
      <main class="relative z-10 container mx-auto px-4 py-12 min-h-[calc(100vh-80px)] flex flex-col items-center">
        <div class="relative w-full max-w-xl min-h-[500px]">
          <Presence>
            {isInitializing() ? (
              <Motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.2 }}
                class="absolute inset-0 flex items-center justify-center"
              >
                <div class="glass rounded-3xl p-12 text-center max-w-sm w-full">
                  <div class="relative w-16 h-16 mx-auto mb-6">
                    <div class="absolute inset-0 rounded-full border-4 border-purple-500/20" />
                    <div class="absolute inset-0 rounded-full border-4 border-t-purple-500 animate-spin" />
                  </div>
                  <h3 class="text-lg font-semibold mb-2">Powering Up</h3>
                  <p class="text-white/50 text-sm">
                    Preparing secure P2P node...
                  </p>
                </div>
              </Motion.div>
            ) : (
              <Motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                class="absolute inset-0"
              >
                {/* Tabs */}
                <div class="glass rounded-2xl p-1.5 mb-8 flex gap-1 relative overflow-hidden">
                  <Motion.div
                    animate={{
                      left: activeTab() === "send" ? "6px" : "calc(50% + 2px)",
                      right: activeTab() === "send" ? "calc(50% + 2px)" : "6px",
                    }}
                    transition={{ duration: 0.2, easing: "ease-out" }}
                    class="absolute top-1.5 bottom-1.5 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-xl shadow-lg shadow-purple-500/20"
                  />
                  <button
                    onClick={() => setActiveTab("send")}
                    class={`relative z-10 flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-semibold ${activeTab() === "send"
                        ? "text-white"
                        : "text-white/50 hover:text-white/80"
                      }`}
                  >
                    <TbOutlineUpload size={20} />
                    Send
                  </button>
                  <button
                    onClick={() => setActiveTab("receive")}
                    class={`relative z-10 flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-semibold ${activeTab() === "receive"
                        ? "text-white"
                        : "text-white/50 hover:text-white/80"
                      }`}
                  >
                    <TbOutlineDownload size={20} />
                    Receive
                  </button>
                </div>

                {/* Content area */}
                <div class="relative">
                  <Presence exitBeforeEnter>
                    <Switch fallback={null}>
                      <Match when={activeTab() === "send"}>
                        <Motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2, easing: "ease-out" }}
                          class="glass rounded-3xl p-1 overflow-hidden"
                        >
                          <div class="p-8">
                            <SendTab />
                          </div>
                        </Motion.div>
                      </Match>
                      <Match when={activeTab() === "receive"}>
                        <Motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2, easing: "ease-out" }}
                          class="glass rounded-3xl p-1 overflow-hidden"
                        >
                          <div class="p-8">
                            <ReceiveTab isActive={true} />
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          class="relative z-10 mt-auto py-12 text-center"
        >
          <div class="flex items-center justify-center gap-4 mb-4">
            <div class="h-px w-8 bg-white/10" />
            <span class="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold">
              Secure Protocol
            </span>
            <div class="h-px w-8 bg-white/10" />
          </div>
          <p class="text-sm text-white/40">
            Powered by{" "}
            <a
              href="https://iroh.computer"
              target="_blank"
              rel="noopener noreferrer"
              class="text-purple-400/80 hover:text-purple-300 transition-colors font-medium underline underline-offset-4 decoration-purple-500/30"
            >
              iroh.computer
            </a>
          </p>
        </Motion.footer>
      </main>

      {/* Device List Modal */}
      <Show when={auth.isAuthenticated()}>
        <DeviceListModal
          isOpen={isDeviceModalOpen()}
          onClose={() => setIsDeviceModalOpen(false)}
        />
      </Show>
    </div>
  );
}

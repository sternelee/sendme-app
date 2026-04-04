import { createSignal, onMount, Show } from "solid-js";
import { initWasm } from "../../lib/commands";
import SendTab from "../../components/sendme/SendTab";
import ReceiveTab from "../../components/sendme/ReceiveTab";
import TextTab from "../../components/sendme/TextTab";
import { ThemeSwitcher } from "../../lib/ThemeSwitcher";
import { Presence } from "solid-motionone";
import {
  TbOutlineSparkles,
  TbOutlineUpload,
  TbOutlineDownload,
  TbOutlineMessage,
  TbOutlineHistory,
  TbOutlineSettings,
} from "solid-icons/tb";

type ActiveTab = "send" | "receive" | "text" | "history" | "settings";

export default function AppPage() {
  const [activeTab, setActiveTab] = createSignal<ActiveTab>("send");
  const [isInitializing, setIsInitializing] = createSignal(true);

  onMount(async () => {
    try {
      await initWasm();
    } catch (error) {
      console.error("Failed to initialize WASM:", error);
    } finally {
      setIsInitializing(false);
    }
  });

  const tabs = [
    { id: "send" as ActiveTab, icon: TbOutlineUpload, label: "Send" },
    { id: "receive" as ActiveTab, icon: TbOutlineDownload, label: "Receive" },
    { id: "text" as ActiveTab, icon: TbOutlineMessage, label: "Text" },
    { id: "history" as ActiveTab, icon: TbOutlineHistory, label: "History" },
    { id: "settings" as ActiveTab, icon: TbOutlineSettings, label: "Settings" },
  ];

  return (
    <div class="min-h-screen bg-base-100 text-base-content">
      {/* Header */}
      <header class="navbar bg-base-100 border-b border-base-200 sticky top-0 z-50 px-4">
        <div class="flex-1">
          <a href="/" class="btn btn-ghost text-xl font-bold gap-2">
            <div class="w-8 h-8 rounded-lg bg-primary text-primary-content flex items-center justify-center">
              <TbOutlineSparkles size={18} />
            </div>
            <span>Sendme</span>
          </a>
        </div>
        <div class="flex-none">
          <ThemeSwitcher />
        </div>
      </header>

      {/* Main content */}
      <main class="container mx-auto px-4 py-8 min-h-[calc(100vh-80px)] flex flex-col items-center">
        <div class="w-full max-w-2xl space-y-6">
          <Show
            when={!isInitializing()}
            fallback={
              <div class="card bg-base-200">
                <div class="card-body items-center text-center py-16">
                  <span class="loading loading-spinner loading-lg text-primary"></span>
                  <p class="text-base-content/60 mt-4">Initializing secure P2P node...</p>
                </div>
              </div>
            }
          >
            {/* Tab Navigation */}
            <div class="tabs tabs-boxed bg-base-200">
              {tabs.map((tab) => (
                <button
                  class={`tab gap-2 ${activeTab() === tab.id ? "tab-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <tab.icon size={16} />
                  <span class="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div class="card bg-base-200">
              <div class="card-body">
                <Presence>
                  <Show when={activeTab() === "send"}>
                    <SendTab />
                  </Show>
                  <Show when={activeTab() === "receive"}>
                    <ReceiveTab isActive={true} />
                  </Show>
                  <Show when={activeTab() === "text"}>
                    <TextTab />
                  </Show>
                  <Show when={activeTab() === "history"}>
                    <div class="text-center py-12">
                      <TbOutlineHistory size={48} class="mx-auto mb-4 opacity-40" />
                      <p class="text-base-content/60">No transfers yet</p>
                      <p class="text-sm text-base-content/40 mt-1">
                        Your shared and received files will appear here
                      </p>
                    </div>
                  </Show>
                  <Show when={activeTab() === "settings"}>
                    <div class="space-y-4">
                      <div class="flex items-center justify-between">
                        <span class="font-bold">Version</span>
                        <span class="text-base-content/60">v0.31.0</span>
                      </div>
                      <div class="flex items-center justify-between">
                        <span class="font-bold">Protocol</span>
                        <span class="badge badge-success gap-1">
                          <span class="w-2 h-2 rounded-full bg-success-content animate-pulse"></span>
                          P2P Ready
                        </span>
                      </div>
                    </div>
                  </Show>
                </Presence>
              </div>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <footer class="mt-auto pt-12 pb-8 text-center">
          <p class="text-sm text-base-content/40">
            Powered by{" "}
            <a
              href="https://iroh.computer"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-primary"
            >
              iroh.computer
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}

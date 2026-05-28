import { createSignal, onMount, Show, For } from "solid-js";
import { initWasm } from "../../lib/commands";
import SendTab from "../../components/sendme/SendTab";
import ReceiveTab from "../../components/sendme/ReceiveTab";
import TextTab from "../../components/sendme/TextTab";
import FriendsTab from "../../components/sendme/FriendsTab";
import ApiKeysPanel from "../../components/settings/ApiKeysPanel";
import HistoryTab from "../../components/sendme/HistoryTab";
import { ThemeSwitcher, LanguageSwitcher } from "@sendme/ui";
import { i18n } from "@sendme/shared";
import { Presence } from "solid-motionone";
import { useAuth } from "../../lib/contexts/user-auth";
import {
  TbOutlineSparkles,
  TbOutlineUpload,
  TbOutlineDownload,
  TbOutlineMessage,
  TbOutlineHistory,
  TbOutlineSettings,
  TbOutlineUsers,
  TbOutlineLogout,
  TbOutlineUser,
} from "solid-icons/tb";
import IncomingTicketsBanner from "../../components/sendme/IncomingTicketsBanner";

const t = i18n.t;

type ActiveTab =
  | "send"
  | "receive"
  | "text"
  | "friends"
  | "history"
  | "settings";

export default function AppPage() {
  const [activeTab, setActiveTab] = createSignal<ActiveTab>("send");
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [initError, setInitError] = createSignal<string | null>(null);
  const auth = useAuth();

  const initApp = async () => {
    setIsInitializing(true);
    setInitError(null);
    try {
      await initWasm();
    } catch (error) {
      console.error("Failed to initialize WASM:", error);
      setInitError(
        error instanceof Error ? error.message : "Failed to initialize P2P engine",
      );
    } finally {
      setIsInitializing(false);
    }
  };

  onMount(() => {
    initApp();
  });

  const tabs = () => {
    const baseTabs = [
      { id: "send" as ActiveTab, icon: TbOutlineUpload, label: t("common.send") },
      { id: "receive" as ActiveTab, icon: TbOutlineDownload, label: t("common.receive") },
      { id: "text" as ActiveTab, icon: TbOutlineMessage, label: t("common.text") },
      { id: "history" as ActiveTab, icon: TbOutlineHistory, label: t("common.history") },
      { id: "settings" as ActiveTab, icon: TbOutlineSettings, label: t("common.settings") },
    ];
    if (auth.isSignedIn()) {
      baseTabs.splice(3, 0, {
        id: "friends" as ActiveTab,
        icon: TbOutlineUsers,
        label: t("friends.title"),
      });
    }
    return baseTabs;
  };

  const isActive = (id: ActiveTab) => activeTab() === id;

  return (
    <div class="min-h-screen bg-base-200 text-base-content flex">
      {/* Desktop Sidebar */}
      <aside class="hidden md:flex flex-col w-60 border-r border-base-200 bg-base-100/80 backdrop-blur-xl sticky top-0 h-screen z-40">
        {/* Sidebar Logo */}
        <div class="p-4">
          <a href="/" class="btn btn-ghost text-xl font-bold gap-2 justify-start w-full">
            <div class="w-8 h-8 rounded-lg bg-primary text-primary-content flex items-center justify-center shrink-0">
              <TbOutlineSparkles size={18} />
            </div>
            <span>Sendme</span>
          </a>
        </div>

        {/* Sidebar Nav */}
        <nav class="flex-1 px-3 py-2 space-y-1">
          {tabs().map((tab) => (
            <button
              class={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive(tab.id)
                  ? "bg-primary/10 text-primary"
                  : "text-base-content/70 hover:bg-base-200 hover:text-base-content"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={18} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div class="p-4 border-t border-base-200 space-y-3">
          <div class="flex items-center gap-1">
            <div class="bg-base-200/60 rounded-lg">
              <LanguageSwitcher />
            </div>
            <div class="bg-base-200/60 rounded-lg">
              <ThemeSwitcher />
            </div>
          </div>
          <p class="text-xs text-base-content/40">
            v0.31.0
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div class="flex-1 flex flex-col min-h-screen md:min-h-0">
        {/* Mobile Header */}
        <header class="md:hidden navbar bg-base-100 border-b border-base-200 sticky top-0 z-50 px-4">
          <div class="flex-1">
            <a href="/" class="btn btn-ghost text-lg font-bold gap-2 px-0">
              <div class="w-7 h-7 rounded-lg bg-primary text-primary-content flex items-center justify-center">
                <TbOutlineSparkles size={16} />
              </div>
              <span>Sendme</span>
            </a>
          </div>
          <div class="flex-none flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeSwitcher />
            <Show when={auth.user()}>
              {(u) => {
                const user = u();
                return (
                  <div class="dropdown dropdown-end">
                    <div tabindex="0" role="button" class="avatar cursor-pointer" onKeyDown={(e) => { if (e.key === "Escape") (e.currentTarget as HTMLElement).blur(); }}>
                      <div class="w-8 h-8 rounded-full">
                        <Show
                          when={user.imageUrl}
                          fallback={
                            <div class="w-full h-full bg-primary text-primary-content flex items-center justify-center text-sm font-bold rounded-full">
                              {(user.name?.charAt(0) || "?").toUpperCase()}
                            </div>
                          }
                        >
                          <img
                            src={user.imageUrl}
                            alt={user.name || "User"}
                            class="w-full h-full object-cover"
                          />
                        </Show>
                      </div>
                    </div>
                    <ul tabindex="-1" class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-40 border border-base-200 z-50 mt-2">
                      <li>
                        <button onClick={() => auth.signOut()} class="flex items-center gap-2">
                          <TbOutlineLogout size={16} />
                          {t("common.signOut")}
                        </button>
                      </li>
                    </ul>
                  </div>
                );
              }}
            </Show>
          </div>
        </header>

        {/* Desktop Header (right side only) */}
        <header class="hidden md:flex navbar bg-base-100 border-b border-base-200 sticky top-0 z-50 px-6 py-2">
          <div class="flex-1">
            <h1 class="text-lg font-semibold">
              {tabs().find(t => t.id === activeTab())?.label}
            </h1>
          </div>
          <div class="flex-none flex items-center gap-2">
            <Show when={auth.user()}>
              {(u) => {
                const user = u();
                return (
                  <div class="dropdown dropdown-end">
                    <div tabindex="0" role="button" class="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-base-200 cursor-pointer transition-colors" onKeyDown={(e) => { if (e.key === "Escape") (e.currentTarget as HTMLElement).blur(); }}>
                      <div class="avatar">
                        <div class="w-8 h-8 rounded-full">
                          <Show
                            when={user.imageUrl}
                            fallback={
                              <div class="w-full h-full bg-primary text-primary-content flex items-center justify-center text-sm font-bold rounded-full">
                                {(user.name?.charAt(0) || "?").toUpperCase()}
                              </div>
                            }
                          >
                            <img
                              src={user.imageUrl}
                              alt={user.name || "User"}
                              class="w-full h-full object-cover"
                            />
                          </Show>
                        </div>
                      </div>
                      <span class="text-sm font-medium hidden lg:block">{user.name || "User"}</span>
                    </div>
                    <ul tabindex="-1" class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-40 border border-base-200 z-50 mt-2">
                      <li>
                        <button onClick={() => auth.signOut()} class="flex items-center gap-2">
                          <TbOutlineLogout size={16} />
                          {t("common.signOut")}
                        </button>
                      </li>
                    </ul>
                  </div>
                );
              }}
            </Show>
            <Show when={!auth.user()}>
              <a href="/auth/sign-in" class="btn btn-primary btn-sm rounded-lg">
                {t("common.signIn")}
              </a>
            </Show>
          </div>
        </header>

        {/* Content */}
        <main class="flex-1 p-4 md:p-6 lg:p-8 pb-24 md:pb-8">
          <div class="max-w-5xl space-y-4">
            <Show
              when={!isInitializing()}
              fallback={
                <div class="surface-card">
                  <div class="flex flex-col items-center justify-center py-16 text-center">
                    <span class="loading loading-spinner loading-lg text-primary"></span>
                    <p class="text-base-content/60 mt-4">
                      {t("common.initializing")}
                    </p>
                  </div>
                </div>
              }
            >
              <Show
                when={!initError()}
                fallback={
                  <div class="surface-card">
                    <div class="flex flex-col items-center justify-center py-16 text-center space-y-4">
                      <div class="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
                        <TbOutlineSparkles size={28} class="text-error" />
                      </div>
                      <p class="text-error font-semibold">{t("common.initFailed") || "Initialization Failed"}</p>
                      <p class="text-base-content/60 text-sm max-w-sm">{initError()}</p>
                      <button class="btn btn-primary btn-sm rounded-lg" onClick={initApp}>
                        {t("common.retry") || "Retry"}
                      </button>
                    </div>
                  </div>
                }
              >
                {/* Global incoming-tickets banner */}
                <IncomingTicketsBanner />

                {/* Tab Content */}
                <Presence>
                  <Show when={activeTab() === "send"}>
                    <SendTab />
                  </Show>
                  <Show when={activeTab() === "receive"}>
                    <ReceiveTab />
                  </Show>
                  <Show when={activeTab() === "friends"}>
                    <FriendsTab />
                  </Show>
                  <Show when={activeTab() === "text"}>
                    <TextTab />
                  </Show>
                  <Show when={activeTab() === "history"}>
                    <HistoryTab />
                  </Show>
                  <Show when={activeTab() === "settings"}>
                    <SettingsTab />
                  </Show>
                </Presence>
              </Show>
            </Show>
          </div>
        </main>

        {/* Mobile Bottom Dock */}
        <nav class="md:hidden fixed bottom-0 left-0 right-0 bg-base-100/90 backdrop-blur-xl border-t border-base-200 z-50 pb-safe">
          <div class="flex items-center justify-around h-16">
            {tabs().map((tab) => (
              <button
                class={`flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors ${
                  isActive(tab.id)
                    ? "text-primary"
                    : "text-base-content/50"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon size={20} />
                <span class="text-[10px] font-medium">{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

function SettingsTab() {
  const auth = useAuth();

  return (
    <div class="space-y-4">
      {/* Settings Header */}
      <div>
        <p class="section-label">{t("settings.title")}</p>
      </div>

      {/* Account Card */}
      <Show
        when={auth.isSignedIn()}
        fallback={
          <div class="surface-card p-5">
            <div class="flex items-center gap-3">
              <div class="avatar placeholder">
                <div class="bg-primary text-primary-content w-12 h-12 rounded-2xl flex items-center justify-center">
                  <TbOutlineUser size={24} />
                </div>
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-semibold">{t("common.account")}</p>
                <p class="text-sm text-base-content/60">{t("common.signInToSync")}</p>
              </div>
            </div>
            <a href="/auth/sign-in" class="btn btn-primary btn-sm mt-4 w-full rounded-xl">
              {t("common.signIn")}
            </a>
          </div>
        }
      >
        <div class="surface-card p-5">
          <div class="flex items-center gap-3">
            <Show when={auth.user()?.imageUrl}>
              <img
                src={auth.user()!.imageUrl}
                class="w-12 h-12 rounded-2xl object-cover"
                alt="avatar"
              />
            </Show>
            <Show when={!auth.user()?.imageUrl}>
              <div class="avatar placeholder">
                <div class="bg-primary text-primary-content w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold">
                  {(auth.user()?.name?.charAt(0) || "?").toUpperCase()}
                </div>
              </div>
            </Show>
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold">{auth.user()?.name || "User"}</p>
              <p class="truncate text-sm text-base-content/60">
                {auth.user()?.email ?? ""}
              </p>
            </div>
            <button
              onClick={() => auth.signOut()}
              class="btn btn-ghost btn-sm rounded-xl shrink-0"
              title={t("common.signOut")}
            >
              <TbOutlineLogout size={18} />
            </button>
          </div>
        </div>
      </Show>

      {/* Settings Grid */}
      <div class="grid gap-4 md:grid-cols-2">
        {/* Language */}
        <div class="surface-card p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-semibold">{t("settings.language")}</p>
              <p class="text-base-content/60 mt-1 text-sm">
                {t("settings.languageDescription")}
              </p>
            </div>
            <LanguageSwitcher />
          </div>
        </div>

        {/* Theme */}
        <div class="surface-card p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-semibold">{t("settings.theme")}</p>
              <p class="text-base-content/60 mt-1 text-sm">
                {t("settings.themeDescription")}
              </p>
            </div>
            <ThemeSwitcher />
          </div>
        </div>

        {/* Protocol Status */}
        <div class="surface-card p-5">
          <div class="flex items-center justify-between">
            <span class="font-semibold">{t("common.online")}</span>
            <span class="badge badge-success gap-1 rounded-full">
              <span class="bg-success-content h-2 w-2 animate-pulse rounded-full"></span>
              {t("common.p2pReady")}
            </span>
          </div>
          <p class="text-base-content/60 mt-4 text-sm">
            {t("landing.features.fastDesc")}
          </p>
        </div>

        {/* About */}
        <div class="surface-card p-5">
          <p class="font-semibold">{t("settings.about")}</p>
          <p class="text-base-content/60 mt-2 text-sm">
            {t("common.appName")} v0.31.0
          </p>
          <p class="text-base-content/50 mt-1 text-xs">
            {t("common.poweredBy")}{" "}
            <a
              href="https://iroh.computer"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-primary"
            >
              iroh.computer
            </a>
          </p>
        </div>
      </div>

      {/* API Keys — only for signed-in users */}
      <Show when={auth.isSignedIn()}>
        <div class="surface-card p-5">
          <ApiKeysPanel />
        </div>
      </Show>
    </div>
  );
}

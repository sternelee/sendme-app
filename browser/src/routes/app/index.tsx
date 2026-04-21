import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { initWasm } from "../../lib/commands";
import SendTab from "../../components/sendme/SendTab";
import ReceiveTab from "../../components/sendme/ReceiveTab";
import TextTab from "../../components/sendme/TextTab";
import FriendsTab from "../../components/sendme/FriendsTab";
import ApiKeysPanel from "../../components/settings/ApiKeysPanel";
import HistoryTab from "../../components/sendme/HistoryTab";
import { ThemeSwitcher } from "../../lib/ThemeSwitcher";
import { LanguageSwitcher } from "../../lib/LanguageSwitcher";
import { i18n } from "../../lib/i18n";
import { Presence } from "solid-motionone";
import { useAuth } from "../../lib/contexts/user-clerk";
import { useUser } from "clerk-solidjs";
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
import { SignInButton } from "clerk-solidjs";

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
  const { user: clerkUser } = useUser();

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
      {
        id: "send" as ActiveTab,
        icon: TbOutlineUpload,
        label: t("common.send"),
      },
      {
        id: "receive" as ActiveTab,
        icon: TbOutlineDownload,
        label: t("common.receive"),
      },
      {
        id: "text" as ActiveTab,
        icon: TbOutlineMessage,
        label: t("common.text"),
      },
      {
        id: "history" as ActiveTab,
        icon: TbOutlineHistory,
        label: t("common.history"),
      },
      {
        id: "settings" as ActiveTab,
        icon: TbOutlineSettings,
        label: t("common.settings"),
      },
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
        <div class="flex-none flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeSwitcher />
          <Show when={clerkUser()}>
            {(u) => {
              const primaryEmail =
                u().emailAddresses.find(
                  (e) => e.id === u().primaryEmailAddressId,
                )?.emailAddress ?? u().emailAddresses[0]?.emailAddress ?? "";
              return (
                <div class="dropdown dropdown-end">
                  <div tabindex="0" role="button" class="tooltip tooltip-bottom" data-tip={primaryEmail} onKeyDown={(e) => { if (e.key === "Escape") (e.currentTarget as HTMLElement).blur(); }}>
                    <div class="avatar cursor-pointer">
                      <div class="w-8 h-8 rounded-full">
                        <Show
                          when={u().imageUrl}
                          fallback={
                            <div class="w-full h-full bg-primary text-primary-content flex items-center justify-center text-sm font-bold rounded-full">
                              {(u().firstName?.charAt(0) || u().username?.charAt(0) || "?").toUpperCase()}
                            </div>
                          }
                        >
                          <img
                            src={u().imageUrl!}
                            alt={u().fullName || "User"}
                            class="w-full h-full object-cover"
                          />
                        </Show>
                      </div>
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

      {/* Main content */}
      <main class="container mx-auto px-4 py-8 min-h-[calc(100vh-80px)] flex flex-col items-center">
        <div class="w-full max-w-2xl space-y-6">
          <Show
            when={!isInitializing()}
            fallback={
              <div class="card bg-base-200">
                <div class="card-body items-center text-center py-16">
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
                <div class="card bg-base-200">
                  <div class="card-body items-center text-center py-16 space-y-4">
                    <div class="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
                      <TbOutlineSparkles size={28} class="text-error" />
                    </div>
                    <p class="text-error font-semibold">{t("common.initFailed") || "Initialization Failed"}</p>
                    <p class="text-base-content/60 text-sm max-w-sm">{initError()}</p>
                    <button class="btn btn-primary btn-sm" onClick={initApp}>
                      {t("common.retry") || "Retry"}
                    </button>
                  </div>
                </div>
              }
            >
            {/* Tab Navigation */}
            <div class="tabs tabs-boxed bg-base-200 flex" role="tablist" aria-label={t("common.navigation") || "Navigation"}>
              {tabs().map((tab) => (
                <button
                  role="tab"
                  aria-selected={activeTab() === tab.id}
                  aria-controls={`panel-${tab.id}`}
                  id={`tab-${tab.id}`}
                  tabindex={activeTab() === tab.id ? 0 : -1}
                  class={`tab gap-2 flex-1 ${activeTab() === tab.id ? "tab-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => {
                    const tabEls = (e.currentTarget.parentElement?.querySelectorAll('[role="tab"]') as NodeListOf<HTMLButtonElement>) || [];
                    const list = Array.from(tabEls);
                    const idx = list.indexOf(e.currentTarget);
                    let next = idx;
                    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % list.length;
                    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + list.length) % list.length;
                    else if (e.key === "Home") next = 0;
                    else if (e.key === "End") next = list.length - 1;
                    else return;
                    e.preventDefault();
                    list[next].focus();
                    setActiveTab(tabs()[next].id);
                  }}
                  title={tab.label}
                >
                  <tab.icon size={16} aria-hidden="true" />
                  <span class="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div class="card bg-base-200">
              <div class="card-body">
                <Presence>
                  <Show when={activeTab() === "send"}>
                    <div role="tabpanel" id="panel-send" aria-labelledby="tab-send">
                      <SendTab />
                    </div>
                  </Show>
                  <Show when={activeTab() === "receive"}>
                    <div role="tabpanel" id="panel-receive" aria-labelledby="tab-receive">
                      <ReceiveTab isActive={true} />
                    </div>
                  </Show>
                  <Show when={activeTab() === "friends"}>
                    <div role="tabpanel" id="panel-friends" aria-labelledby="tab-friends">
                      <FriendsTab />
                    </div>
                  </Show>
                  <Show when={activeTab() === "text"}>
                    <div role="tabpanel" id="panel-text" aria-labelledby="tab-text">
                      <TextTab />
                    </div>
                  </Show>
                  <Show when={activeTab() === "history"}>
                    <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
                      <HistoryTab />
                    </div>
                  </Show>
                  <Show when={activeTab() === "settings"}>
                    <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
                    <div class="space-y-4">
                      <div class="flex items-center justify-between">
                        <span class="font-bold">{t("settings.title")}</span>
                        <span class="text-base-content/60">v0.31.0</span>
                      </div>

                      {/* Account Card */}
                      <Show
                        when={auth.isSignedIn()}
                        fallback={
                          <div class="bg-base-300 rounded-xl p-4">
                            <div class="flex items-center gap-3">
                              <div class="avatar placeholder">
                                <div class="bg-primary text-primary-content w-10 h-10 rounded-full flex items-center justify-center">
                                  <TbOutlineUser size={20} />
                                </div>
                              </div>
                              <div class="flex-1">
                                <p class="font-semibold">{t("common.account")}</p>
                                <p class="text-sm text-base-content/60">{t("common.signInToSync")}</p>
                              </div>
                            </div>
                            <SignInButton mode="modal">
                              <button class="btn btn-primary btn-sm mt-3 w-full rounded-lg">
                                {t("common.signIn")}
                              </button>
                            </SignInButton>
                          </div>
                        }
                      >
                        <div class="bg-base-300 rounded-xl p-4">
                          <div class="flex items-center gap-3">
                            <Show when={clerkUser()?.imageUrl}>
                              <img
                                src={clerkUser()!.imageUrl}
                                class="w-10 h-10 rounded-full object-cover"
                                alt="avatar"
                              />
                            </Show>
                            <Show when={!clerkUser()?.imageUrl}>
                              <div class="avatar placeholder">
                                <div class="bg-primary text-primary-content w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold">
                                  {(clerkUser()?.firstName?.charAt(0) || clerkUser()?.username?.charAt(0) || "?").toUpperCase()}
                                </div>
                              </div>
                            </Show>
                            <div class="min-w-0 flex-1">
                              <p class="truncate font-semibold">{clerkUser()?.fullName || clerkUser()?.username || "User"}</p>
                              <p class="truncate text-sm text-base-content/60">
                                {clerkUser()?.emailAddresses.find((e) => e.id === clerkUser()?.primaryEmailAddressId)?.emailAddress ?? ""}
                              </p>
                            </div>
                            <button
                              onClick={() => auth.signOut()}
                              class="btn btn-ghost btn-sm rounded-lg"
                              title={t("common.signOut")}
                            >
                              <TbOutlineLogout size={18} />
                            </button>
                          </div>
                        </div>
                        </Show>

                        {/* API Keys — only for signed-in users */}
                        <Show when={auth.isSignedIn()}>
                          <div class="divider my-1" />
                          <ApiKeysPanel />
                          <div class="divider my-1" />
                        </Show>

                        <div class="flex items-center justify-between">
                        <span class="font-bold">{t("common.protocol")}</span>
                        <span class="badge badge-success gap-1">
                          <span class="w-2 h-2 rounded-full bg-success-content animate-pulse"></span>
                          {t("common.p2pReady")}
                        </span>
                      </div>
                    </div>
                    </div>
                  </Show>
                </Presence>
              </div>
            </div>
          </Show>
          </Show>
        </div>

        {/* Footer */}
        <footer class="mt-auto pt-12 pb-8 text-center">
          <p class="text-sm text-base-content/40">
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
        </footer>
      </main>
    </div>
  );
}

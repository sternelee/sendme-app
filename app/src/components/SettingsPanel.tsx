import { Component, createSignal, onMount, Show } from "solid-js";
import { User, LogOut, Route } from "lucide-solid";
import { platform } from "@tauri-apps/plugin-os";
import { i18n } from "@sendme/shared";
import { ThemeSwitcher, LanguageSwitcher } from "@sendme/ui";
import { useAuth } from "~/lib/auth";
import AuthPanel from "./AuthPanel";
import {
  get_context_menu_diagnostics,
  get_context_menu_enabled,
  set_context_menu_enabled,
} from "~/bindings";
import { clearDebugLog, exportDebugLog } from "~/lib/debug-log";
import { copyToClipboard } from "~/lib/utils";
import type { TransferRoutingPolicy } from "~/lib/types";

const t = i18n.t;

interface SettingsPanelProps {
  routingPolicy?: TransferRoutingPolicy;
  setRoutingPolicy?: (policy: TransferRoutingPolicy) => void;
}

export const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  const auth = useAuth();
  const currentPlatform = platform();
  const isDesktop =
    currentPlatform === "windows" ||
    currentPlatform === "linux" ||
    currentPlatform === "macos";
  const supportsContextMenuToggle =
    currentPlatform === "windows" ||
    currentPlatform === "linux" ||
    currentPlatform === "macos";

  const [contextMenuEnabled, setContextMenuEnabled] = createSignal(false);
  const [contextMenuLoading, setContextMenuLoading] = createSignal(false);

  onMount(async () => {
    if (supportsContextMenuToggle) {
      try {
        const enabled = await get_context_menu_enabled();
        setContextMenuEnabled(enabled);
        if (currentPlatform === "macos") {
          console.info(await get_context_menu_diagnostics());
        }
      } catch (e) {
        console.error("Failed to read context menu state", e);
      }
    }
  });

  const toggleContextMenu = async () => {
    const next = !contextMenuEnabled();
    setContextMenuLoading(true);
    try {
      await set_context_menu_enabled(next);
      setContextMenuEnabled(next);
      if (currentPlatform === "macos") {
        console.info(await get_context_menu_diagnostics());
      }
    } catch (e) {
      console.error("Failed to toggle context menu", e);
    } finally {
      setContextMenuLoading(false);
    }
  };

  const copyDiagnostics = async () => {
    await copyToClipboard(exportDebugLog() || "No diagnostics collected yet.");
  };

  return (
    <div class="space-y-4">
      <div>
        <p class="section-label">{t("settings.title")}</p>
      </div>

      <Show when={auth.isSignedIn()} fallback={<AuthPanel startCollapsed />}>
        <div class="surface-card p-5">
          <div class="flex items-center gap-3">
            <Show when={auth.user()?.imageUrl}>
              <img
                src={auth.user()!.imageUrl}
                class="h-12 w-12 rounded-xl"
                alt="avatar"
              />
            </Show>
            <Show when={!auth.user()?.imageUrl}>
              <div class="flex items-center gap-3">
                <div class="avatar placeholder">
                  <div class="bg-primary text-primary-content flex w-12 items-center justify-center rounded-xl">
                    <User size={20} />
                  </div>
                </div>
              </div>
            </Show>
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold">
                {auth.user()?.name || "User"}
              </p>
              <p class="truncate text-xs opacity-60">{auth.user()?.email}</p>
            </div>
            <button
              onClick={() => auth.signOut()}
              class="btn btn-ghost btn-sm rounded-xl"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="surface-card p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-semibold">{t("settings.language")}</p>
              <p class="text-base-content/60 mt-2 text-sm">
                {t("settings.languageDescription")}
              </p>
            </div>
            <LanguageSwitcher />
          </div>
        </div>

        <div class="surface-card p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-semibold">{t("settings.theme")}</p>
              <p class="text-base-content/60 mt-2 text-sm">
                {t("settings.themeDescription")}
              </p>
            </div>
            <ThemeSwitcher />
          </div>
        </div>

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

        <div class="surface-card p-5">
          <p class="font-semibold">{t("common.version")}</p>
          <p class="text-base-content/60 mt-2 text-sm">
            {t("common.appName")} v0.31.0
          </p>
          <p class="text-base-content/50 mt-1 text-xs">
            {t("common.poweredBy")}
          </p>
        </div>

        <Show when={isDesktop && supportsContextMenuToggle}>
          <div class="surface-card p-5 md:col-span-2">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 flex-1">
                <p class="font-semibold">{t("settings.contextMenu")}</p>
                <p class="text-base-content/60 mt-2 text-sm">
                  {t("settings.contextMenuDescription")}
                </p>
              </div>
              <input
                type="checkbox"
                class="toggle toggle-primary shrink-0"
                checked={contextMenuEnabled()}
                disabled={contextMenuLoading()}
                onChange={toggleContextMenu}
              />
            </div>
          </div>
        </Show>

        <div class="surface-card p-5 md:col-span-2">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <Route size={16} class="text-primary" />
                <p class="font-semibold">{t("settings.routingPolicy")}</p>
              </div>
              <p class="text-base-content/60 mt-2 text-sm">
                {t("settings.routingPolicyDescription")}
              </p>
            </div>
            <Show when={props.routingPolicy && props.setRoutingPolicy}>
              <div
                class="join border-base-300/80 bg-base-100/70 shrink-0 rounded-xl border p-1"
                role="radiogroup"
                aria-label={t("settings.routingPolicy")}
              >
                <button
                  class={`join-item btn btn-xs rounded-lg ${props.routingPolicy === "auto" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => props.setRoutingPolicy!("auto")}
                  role="radio"
                  aria-checked={props.routingPolicy === "auto"}
                >
                  {t("common.routingPolicyAuto")}
                </button>
                <button
                  class={`join-item btn btn-xs rounded-lg ${props.routingPolicy === "local_only" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => props.setRoutingPolicy!("local_only")}
                  role="radio"
                  aria-checked={props.routingPolicy === "local_only"}
                >
                  {t("common.routingPolicyLocalOnly")}
                </button>
                <button
                  class={`join-item btn btn-xs rounded-lg ${props.routingPolicy === "remote_only" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => props.setRoutingPolicy!("remote_only")}
                  role="radio"
                  aria-checked={props.routingPolicy === "remote_only"}
                >
                  {t("common.routingPolicyRemoteOnly")}
                </button>
              </div>
            </Show>
          </div>
        </div>

        <div class="surface-card p-5 md:col-span-2">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 flex-1">
              <p class="font-semibold">{t("settings.diagnostics")}</p>
              <p class="text-base-content/60 mt-2 text-sm">
                {t("settings.diagnosticsDescription")}
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <button
                type="button"
                class="btn btn-ghost btn-sm rounded-xl"
                onClick={clearDebugLog}
              >
                {t("common.clear")}
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm rounded-xl"
                onClick={copyDiagnostics}
              >
                {t("settings.copyDiagnostics")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

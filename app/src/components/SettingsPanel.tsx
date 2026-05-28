import { Component, Show } from "solid-js";
import { User, LogOut } from "lucide-solid";
import { i18n } from "@sendme/shared";
import { ThemeSwitcher, LanguageSwitcher } from "@sendme/ui";
import { useAuth } from "~/lib/auth";
import AuthPanel from "./AuthPanel";

const t = i18n.t;

export const SettingsPanel: Component = () => {
  const auth = useAuth();

  return (
    <div class="space-y-4">
      <div>
        <p class="section-label">{t("settings.title")}</p>
      </div>

      <Show when={auth.isSignedIn()} fallback={<AuthPanel />}>
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

      <div class="grid gap-4 md:grid-cols-2">
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
      </div>
    </div>
  );
};

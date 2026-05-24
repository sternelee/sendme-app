import { Component, Show } from "solid-js";
import {
  Send,
  Download,
  FileText,
  Share2,
  Radio,
  Smartphone,
  User,
  Shield,
} from "lucide-solid";
import { i18n } from "@sendme/shared";
import { getDisplayName } from "@sendme/ui";

import { useGlobalStore } from "~/lib/store";
import { SendPanel } from "./SendPanel";
import { ReceivePanel } from "./ReceivePanel";
import NearbyPage from "~/routes/nearby";
import DevicesPage from "~/routes/devices";
import FriendsPage from "~/routes/friends";
import type { ShareSubTab, TransferMode } from "~/lib/types";

const t = i18n.t;

interface TransferTabProps {
  transferMode: TransferMode;
  setTransferView: (mode: TransferMode) => void;
  shareSubTab: ShareSubTab;
  setShareSubTab: (tab: ShareSubTab) => void;
  isMobile: boolean;
  showQrCode: boolean;
  setShowQrCode: (v: boolean) => void;
  onCopy: (text: string) => Promise<void>;
  onShare: (text: string) => Promise<void>;
  onTransferComplete?: () => void;
}

export const TransferTab: Component<TransferTabProps> = (props) => {
  const globalStore = useGlobalStore();

  function renderTransferTitleIcon() {
    if (props.transferMode === "receive") {
      return <Download size={18} class="text-secondary" />;
    }
    if (props.transferMode === "text") {
      return <FileText size={18} class="text-accent" />;
    }
    return <Send size={18} class="text-primary" />;
  }

  return (
    <div class="space-y-6">
      <div class="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <section class="surface-card space-y-5 p-5 md:p-6">
          <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                {renderTransferTitleIcon()}
                <h1 class="text-xl font-semibold md:text-2xl">
                  {props.transferMode === "send"
                    ? t("send.title")
                    : props.transferMode === "receive"
                      ? t("receive.title")
                      : t("text.title")}
                </h1>
              </div>
              <div>
                <p class="text-base-content/65 mt-2 max-w-2xl text-sm leading-6">
                  {props.transferMode === "send"
                    ? t("send.subtitle")
                    : props.transferMode === "receive"
                      ? t("receive.subtitle")
                      : t("text.subtitle")}
                </p>
              </div>
            </div>

            <div class="join border-base-300/80 bg-base-100/60 flex gap-2 self-start rounded-2xl border p-1">
              <button
                class={`join-item btn rounded-2xl border-0 ${props.transferMode === "send" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => props.setTransferView("send")}
              >
                {t("common.send")}
              </button>
              <button
                class={`join-item btn rounded-2xl border-0 ${props.transferMode === "receive" ? "btn-secondary" : "btn-ghost"}`}
                onClick={() => props.setTransferView("receive")}
              >
                {t("common.receive")}
              </button>
              <button
                class={`join-item btn rounded-2xl border-0 ${props.transferMode === "text" ? "btn-accent" : "btn-ghost"}`}
                onClick={() => props.setTransferView("text")}
              >
                {t("common.text")}
              </button>
            </div>
          </div>

          <Show
            when={props.transferMode !== "receive"}
            fallback={
              <ReceivePanel
                isMobile={props.isMobile}
                onReload={props.onTransferComplete}
              />
            }
          >
            <SendPanel
              isMobile={props.isMobile}
              showQrCode={props.showQrCode}
              setShowQrCode={props.setShowQrCode}
              onCopy={props.onCopy}
              onShare={props.onShare}
              onTransferComplete={props.onTransferComplete}
            />
          </Show>
        </section>

        <Show when={globalStore.send.state().path || globalStore.send.state().textContent?.trim()}>
          <div class="flex items-center gap-3 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-2.5">
            <FileText size={16} class="text-primary shrink-0" />
            <span class="text-sm truncate font-medium">
              {globalStore.send.state().isTextMode
                ? "Text message"
                : getDisplayName(globalStore.send.state().path)}
            </span>
            <span class="text-xs opacity-50 ml-auto shrink-0">
              Ready to share
            </span>
          </div>
        </Show>

        <div class="space-y-4">
          <Show
            when={
              globalStore.nearbyReceive.state().incomingRequest &&
              globalStore.nearbyReceive.state().transferState === "review"
            }
          >
            <div class="surface-card border-secondary/20 bg-secondary/10 p-5">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-secondary/80 text-xs font-semibold tracking-[0.2em] uppercase">
                    {t("nearby.transferRequest")}
                  </p>
                  <p class="text-base-content/75 mt-2 text-sm leading-6">
                    {t("nearby.requestModalHint")}
                  </p>
                </div>
                <button
                  onClick={() => props.setTransferView("receive")}
                  class="btn btn-secondary btn-sm rounded-xl"
                >
                  {t("nearby.openReceive")}
                </button>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <section class="surface-card space-y-4 p-4 md:p-5">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div class="flex items-center gap-2">
              <Share2 size={18} class="text-primary" />
              <h2 class="text-xl font-semibold">
                {t("nearby.workspaceTitle")}
              </h2>
            </div>
            <p class="text-base-content/65 mt-2 text-sm leading-6">
              {t("nearby.workspaceSubtitle")}
            </p>
          </div>

          <div class="tabs tabs-boxed bg-base-100/80 p-1">
            <button
              class={`tab gap-2 rounded-2xl ${props.shareSubTab === "nearby" ? "tab-active" : ""}`}
              onClick={() => props.setShareSubTab("nearby")}
            >
              <Radio size={16} />
              {t("nearby.title")}
            </button>
            <button
              class={`tab gap-2 rounded-2xl ${props.shareSubTab === "devices" ? "tab-active" : ""}`}
              onClick={() => props.setShareSubTab("devices")}
            >
              <Smartphone size={16} />
              {t("devices.title")}
            </button>
            <button
              class={`tab gap-2 rounded-2xl ${props.shareSubTab === "friends" ? "tab-active" : ""}`}
              onClick={() => props.setShareSubTab("friends")}
            >
              <User size={16} />
              {t("friends.title")}
            </button>
          </div>
        </div>

        <Show when={props.shareSubTab === "nearby"}>
          <NearbyPage
            sendPath={globalStore.send.state().path || undefined}
            isFolder={globalStore.send.state().isFolder}
          />
        </Show>
        <Show when={props.shareSubTab === "devices"}>
          <DevicesPage
            sendPath={globalStore.send.state().path || undefined}
            isTextMode={globalStore.send.state().isTextMode}
            textContent={globalStore.send.state().textContent}
          />
        </Show>
        <Show when={props.shareSubTab === "friends"}>
          <FriendsPage
            sendPath={globalStore.send.state().path || undefined}
            isTextMode={globalStore.send.state().isTextMode}
            textContent={globalStore.send.state().textContent}
          />
        </Show>
      </section>

      <section class="surface-card p-5">
        <div class="mb-4 flex items-center gap-2">
          <Shield size={18} class="text-primary" />
          <h2 class="text-lg font-semibold">
            {t("common.protocol")}
          </h2>
        </div>
        <div class="space-y-3">
          <div class="border-base-300/70 bg-base-100/70 rounded-2xl border p-4">
            <p class="text-sm font-medium">
              {t("landing.features.encryptedTitle")}
            </p>
            <p class="text-base-content/65 mt-1 text-xs leading-5">
              {t("landing.features.encryptedDesc")}
            </p>
          </div>
          <div class="border-base-300/70 bg-base-100/70 rounded-2xl border p-4">
            <p class="text-sm font-medium">
              {t("landing.features.fastTitle")}
            </p>
            <p class="text-base-content/65 mt-1 text-xs leading-5">
              {t("landing.features.fastDesc")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

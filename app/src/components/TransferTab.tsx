import { Component, Show, createMemo } from "solid-js";
import { Send, Download, FileText, Share2 } from "lucide-solid";
import { i18n } from "@sendme/shared";
import { getDisplayName } from "@sendme/ui";

import { useGlobalStore } from "~/lib/store";
import { SendPanel } from "./SendPanel";
import { ReceivePanel } from "./ReceivePanel";
import { RecipientPicker } from "./RecipientPicker";
import {
  buildIncomingReminders,
  type PendingReceiveCard,
  shouldShowShareWorkspace,
} from "~/lib/transfer-ui";
import type { TransferMode, TransferRoutingPolicy } from "~/lib/types";

const t = i18n.t;

interface TransferTabProps {
  transferMode: TransferMode;
  setTransferView: (mode: TransferMode) => void;
  routingPolicy: TransferRoutingPolicy;
  isMobile: boolean;
  showQrCode: boolean;
  setShowQrCode: (v: boolean) => void;
  onCopy: (text: string) => Promise<void>;
  onShare: (text: string) => Promise<void>;
  pendingReceiveCards: PendingReceiveCard[];
  onTransferComplete?: () => void;
}

export const TransferTab: Component<TransferTabProps> = (props) => {
  const globalStore = useGlobalStore();

  // Only requests awaiting a decision count as incoming; requests already
  // accepted into a background transfer are excluded.
  const incomingReminderCount = createMemo(() => {
    const nearbyState = globalStore.nearbyReceive.state();
    const actionableNearbyRequests = nearbyState.incomingRequests.filter(
      (request) =>
        nearbyState.pendingRequestStates[request.id] !== "accepting" &&
        nearbyState.activeRequestId !== request.id,
    );
    return buildIncomingReminders({
      nearbyRequests: actionableNearbyRequests,
      cloudTickets: globalStore.cloudReceive.state().tickets,
    }).totalCount;
  });

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
      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
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

            <div
              class="join border-base-300/80 bg-base-100/60 flex gap-2 self-start rounded-md border p-1"
              role="radiogroup"
              aria-label={t("common.transfer")}
            >
              <button
                class={`join-item btn rounded-xl border-0 ${props.transferMode === "send" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => props.setTransferView("send")}
                role="radio"
                aria-checked={props.transferMode === "send"}
              >
                {t("common.send")}
              </button>
              <button
                class={`join-item btn rounded-xl border-0 ${props.transferMode === "receive" ? "btn-secondary" : "btn-ghost"}`}
                onClick={() => props.setTransferView("receive")}
                role="radio"
                aria-checked={props.transferMode === "receive"}
              >
                {t("common.receive")}
              </button>
              <button
                class={`join-item btn rounded-xl border-0 ${props.transferMode === "text" ? "btn-accent" : "btn-ghost"}`}
                onClick={() => props.setTransferView("text")}
                role="radio"
                aria-checked={props.transferMode === "text"}
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
                pendingReceiveCards={props.pendingReceiveCards}
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

        <div class="space-y-4">
          <Show
            when={
              shouldShowShareWorkspace(props.transferMode) &&
              (globalStore.send.state().path ||
                globalStore.send.state().textContent?.trim())
            }
          >
            <div class="border-primary/15 bg-primary/5 flex min-w-0 items-center gap-3 rounded-xl border px-4 py-3">
              <FileText size={16} class="text-primary shrink-0" />
              <span class="min-w-0 truncate text-sm font-medium">
                {globalStore.send.state().isTextMode
                  ? t("text.title")
                  : getDisplayName(globalStore.send.state().path)}
              </span>
              <span class="ml-auto shrink-0 text-xs opacity-50">
                {t("send.readyToShare")}
              </span>
            </div>
          </Show>

          <Show when={props.transferMode === "receive"}>
            <div class="surface-card space-y-4 p-5">
              <div>
                <div class="flex items-center gap-2">
                  <Download size={18} class="text-secondary" />
                  <h2 class="text-lg font-semibold">
                    {t("receive.receiveWorkspaceTitle")}
                  </h2>
                </div>
                <p class="text-base-content/65 mt-2 text-sm leading-6">
                  {t("receive.stackHint")}
                </p>
              </div>

              <div class="border-base-300/70 bg-base-100/70 rounded-xl border px-4 py-3">
                <p class="text-base-content/55 text-[11px] font-semibold tracking-[0.16em] uppercase">
                  {t("common.defaultDownloads")}
                </p>
                <p class="mt-2 truncate text-sm font-medium">
                  {globalStore.receive.state().outputDir ||
                    t("common.defaultDownloads")}
                </p>
              </div>

              <Show when={incomingReminderCount() > 0}>
                <div class="border-secondary/20 bg-secondary/10 rounded-xl border px-4 py-3 text-sm">
                  <p class="text-secondary font-medium">
                    {t("receive.incomingCount", {
                      count: incomingReminderCount(),
                    })}
                  </p>
                  <p class="text-base-content/70 mt-1 text-xs leading-5">
                    {t("receive.bottomStackHint")}
                  </p>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <Show when={shouldShowShareWorkspace(props.transferMode)}>
        <section class="surface-card space-y-4 p-4 md:p-5">
          <div>
            <div class="flex items-center gap-2">
              <Share2 size={18} class="text-primary" />
              <h2 class="text-xl font-semibold">{t("recipients.title")}</h2>
            </div>
            <p class="text-base-content/65 mt-2 max-w-2xl text-sm leading-6">
              {t("recipients.subtitle")}
            </p>
          </div>

          <RecipientPicker
            sendPath={globalStore.send.state().path || undefined}
            isFolder={globalStore.send.state().isFolder}
            routingPolicy={props.routingPolicy}
          />
        </section>
      </Show>
    </div>
  );
};

import { Component, Show } from "solid-js";
import { Copy, Share2, ChevronDown } from "lucide-solid";
import { i18n } from "@sendme/shared";

const t = i18n.t;

interface ShareTicketCardProps {
  ticket: string;
  qrCode?: string;
  isMobile: boolean;
  showQrCode: boolean;
  setShowQrCode: (value: boolean) => void;
  title: string;
  subtitle?: string;
  onCopy: (text: string) => Promise<void>;
  onShare: (text: string) => Promise<void>;
}

export const ShareTicketCard: Component<ShareTicketCardProps> = (props) => {
  const canShare = () => typeof navigator !== "undefined" && "share" in navigator;
  const showQrInline = () => !props.isMobile || props.showQrCode;

  return (
    <div class="space-y-4">
      <div>
        <p class="text-sm font-semibold">{props.title}</p>
        <Show when={props.subtitle}>
          <p class="text-base-content/60 mt-1 text-xs leading-5">{props.subtitle}</p>
        </Show>
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <button
          onClick={() => props.onCopy(props.ticket)}
          class="btn btn-primary btn-sm rounded-2xl"
        >
          <Copy size={14} /> {t("common.copy")}
        </button>
        <Show when={canShare()} fallback={<div class="hidden sm:block" />}>
          <button
            onClick={() => props.onShare(props.ticket)}
            class="btn btn-outline btn-sm rounded-2xl"
          >
            <Share2 size={14} /> {t("common.share")}
          </button>
        </Show>
      </div>

      <Show when={props.qrCode && props.isMobile}>
        <button
          onClick={() => props.setShowQrCode(!props.showQrCode)}
          class="btn btn-ghost btn-sm w-full gap-1 rounded-2xl"
        >
          <ChevronDown
            size={14}
            class={`transition-transform ${props.showQrCode ? "rotate-180" : ""}`}
          />
          {props.showQrCode ? t("send.hideQrCode") : t("send.showQrCode")}
        </button>
      </Show>

      <Show when={props.qrCode && showQrInline()}>
        <div class="flex justify-center">
          <div class="rounded-xl bg-base-100 p-3">
            <img src={props.qrCode} alt="QR" class="h-48 w-48" />
          </div>
        </div>
      </Show>

      <div class="bg-base-300/50 overflow-hidden rounded-xl p-3">
        <code class="text-primary font-mono text-xs break-all">{props.ticket}</code>
      </div>
    </div>
  );
};

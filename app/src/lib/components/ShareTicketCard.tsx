import { Component, Show } from "solid-js";
import { Copy, Share2, ChevronDown, QrCode } from "lucide-solid";
import { Motion } from "solid-motionone";
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
  const canShare = () =>
    typeof navigator !== "undefined" && "share" in navigator;
  const showQrInline = () => !props.isMobile || props.showQrCode;

  return (
    <div class="space-y-4">
      <div>
        <p class="text-sm font-semibold">{props.title}</p>
        <Show when={props.subtitle}>
          <p class="text-base-content/60 mt-1 text-xs leading-5">
            {props.subtitle}
          </p>
        </Show>
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <Motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => props.onCopy(props.ticket)}
          class="btn btn-primary btn-sm gap-2 rounded-2xl"
        >
          <Copy size={14} /> {t("common.copy")}
        </Motion.button>
        <Show when={canShare()} fallback={<div class="hidden sm:block" />}>
          <Motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => props.onShare(props.ticket)}
            class="btn btn-outline btn-sm gap-2 rounded-2xl"
          >
            <Share2 size={14} /> {t("common.share")}
          </Motion.button>
        </Show>
      </div>

      <Show when={props.qrCode && props.isMobile}>
        <Motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => props.setShowQrCode(!props.showQrCode)}
          class="btn btn-ghost btn-sm w-full gap-2 rounded-2xl"
        >
          <QrCode size={14} />
          <Motion.div
            animate={{ rotate: props.showQrCode ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown size={14} />
          </Motion.div>
          {props.showQrCode ? t("send.hideQrCode") : t("send.showQrCode")}
        </Motion.button>
      </Show>

      <Show when={props.qrCode && showQrInline()}>
        <Motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          class="flex justify-center"
        >
          <div class="rounded-2xl bg-white p-4 shadow-lg">
            <img src={props.qrCode} alt="QR" class="h-48 w-48" />
          </div>
        </Motion.div>
      </Show>

      <div class="bg-base-300/50 group relative overflow-hidden rounded-xl p-3">
        <code class="text-primary font-mono text-xs break-all">
          {props.ticket}
        </code>
        <Motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => props.onCopy(props.ticket)}
          class="bg-base-100/80 absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label={t("common.copy")}
        >
          <Copy size={12} />
        </Motion.button>
      </div>
    </div>
  );
};

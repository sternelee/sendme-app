import { Component } from "solid-js";
import { X } from "lucide-solid";
import { formatFileSize } from "~/lib/utils";
import { i18n } from "~/lib/i18n";

const t = i18n.t;

interface TransferProgressProps {
  transferred: number;
  total: number;
  speed: number;
  eta: number;
  isReceiving?: boolean;
  onCancel: () => void;
}

export const TransferProgress: Component<TransferProgressProps> = (props) => {
  const percent = () =>
    props.total > 0 ? Math.round((props.transferred / props.total) * 100) : 0;
  const speedStr = () => formatFileSize(props.speed) + "/s";
  const etaStr = () => {
    if (props.eta < 60) return "~0 min";
    if (props.eta < 3600) return `~${Math.round(props.eta / 60)} min`;
    return `~${Math.round(props.eta / 3600)} hr`;
  };

  return (
    <div class="border-base-300/70 bg-base-100/80 rounded-3xl border p-4 shadow-sm">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div>
          <p class="text-base-content/55 text-xs font-semibold tracking-[0.2em] uppercase">
            {props.isReceiving ? t("common.receiving") : t("common.send")}
          </p>
          <p class="mt-2 text-2xl font-semibold">{percent()}%</p>
        </div>
        <div class="text-right text-sm opacity-65">
          <p>{speedStr()}</p>
          <p class="mt-1 text-xs">
            {t("nearby.remaining", { time: etaStr() })}
          </p>
        </div>
      </div>

      <progress
        class={`progress w-full ${props.isReceiving ? "progress-secondary" : "progress-primary"}`}
        value={props.transferred}
        max={props.total}
      ></progress>
      <div class="mt-3 flex justify-between text-xs opacity-60">
        <span>
          {formatFileSize(props.transferred)} / {formatFileSize(props.total)}
        </span>
      </div>
      <button
        onClick={props.onCancel}
        class="btn btn-ghost btn-sm text-error mt-4 w-full rounded-2xl"
      >
        <X size={14} class="mr-1" /> {t("common.cancel")}
      </button>
    </div>
  );
};

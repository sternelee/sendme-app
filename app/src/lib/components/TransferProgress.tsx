import { Component, Show } from "solid-js";
import { CheckCircle2, X } from "lucide-solid";
import { formatFileSize } from "@sendme/ui";
import { i18n } from "@sendme/shared";
import { formatEta } from "~/lib/utils";

const t = i18n.t;

interface TransferProgressProps {
  transferred: number;
  total: number;
  speed: number;
  eta: number;
  isReceiving?: boolean;
  title?: string;
  isCompleted?: boolean;
  isPending?: boolean;
  onCancel?: () => void;
}

export const TransferProgress: Component<TransferProgressProps> = (props) => {
  const percent = () =>
    props.total > 0 ? Math.round((props.transferred / props.total) * 100) : 0;
  const speedStr = () => formatFileSize(props.speed) + "/s";

  return (
    <div class="border-base-300/70 bg-base-100/80 rounded-3xl border p-4 shadow-sm">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-base-content/55 text-xs font-semibold tracking-[0.2em] uppercase">
            {props.isReceiving ? t("common.receiving") : t("common.send")}
          </p>
          <Show when={props.title}>
            <p class="mt-2 truncate text-sm font-medium">{props.title}</p>
          </Show>
          <div class="mt-2 flex items-center gap-2">
            <p class="text-2xl font-semibold">
              {props.isPending ? t("receive.connecting") : `${percent()}%`}
            </p>
            <Show when={props.isCompleted}>
              <span class="badge badge-success gap-1 rounded-xl">
                <CheckCircle2 size={12} />
                {t("receive.downloadComplete")}
              </span>
            </Show>
          </div>
        </div>
        <div class="text-right text-sm opacity-65">
          <Show
            when={!props.isCompleted && !props.isPending}
            fallback={
              <p class="text-xs">
                {props.isCompleted
                  ? t("receive.downloadComplete")
                  : t("receive.stackHint")}
              </p>
            }
          >
            <p>{speedStr()}</p>
            <p class="mt-1 text-xs">
              {t("nearby.remaining", { time: formatEta(props.eta) })}
            </p>
          </Show>
        </div>
      </div>

      <progress
        class={`progress w-full ${props.isReceiving ? "progress-secondary" : "progress-primary"}`}
        value={props.isPending ? undefined : props.transferred}
        max={props.total}
      ></progress>
      <div class="mt-3 flex justify-between text-xs opacity-60">
        <span>
          {props.isPending
            ? t("receive.bottomStackHint")
            : `${formatFileSize(props.transferred)} / ${formatFileSize(props.total)}`}
        </span>
      </div>
      <Show when={props.onCancel && !props.isCompleted}>
        <button
          onClick={() => props.onCancel?.()}
          class="btn btn-ghost btn-sm text-error mt-4 w-full rounded-2xl"
        >
          <X size={14} class="mr-1" /> {t("common.cancel")}
        </button>
      </Show>
    </div>
  );
};

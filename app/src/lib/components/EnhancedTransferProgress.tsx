import { Component, Show, createMemo } from "solid-js";
import { CheckCircle2, X, Zap, Clock, FileCheck } from "lucide-solid";
import { formatFileSize } from "@sendme/ui";
import { i18n } from "@sendme/shared";
import { formatEta } from "~/lib/utils";
import { Motion } from "solid-motionone";

const t = i18n.t;

interface EnhancedTransferProgressProps {
  transferred: number;
  total: number;
  speed: number;
  eta: number;
  isReceiving?: boolean;
  title?: string;
  isCompleted?: boolean;
  isPending?: boolean;
  onCancel?: () => void;
  fileName?: string;
  fileSize?: number;
}

// 环形进度组件
const ProgressRing: Component<{
  percent: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  isCompleted?: boolean;
}> = (props) => {
  const size = () => props.size || 56;
  const strokeWidth = () => props.strokeWidth || 4;
  const radius = () => (size() - strokeWidth()) / 2;
  const circumference = () => radius() * 2 * Math.PI;
  const offset = () =>
    circumference() - (props.percent / 100) * circumference();

  return (
    <div class="relative inline-flex items-center justify-center" style={{ width: `${size()}px`, height: `${size()}px` }}>
      <svg
        class="-rotate-90 transition-all duration-500"
        width={size()}
        height={size()}
      >
        {/* 背景环 */}
        <circle
          cx={size() / 2}
          cy={size() / 2}
          r={radius()}
          fill="none"
          stroke="currentColor"
          class="text-base-300/40"
          stroke-width={strokeWidth()}
        />
        {/* 进度环 */}
        <circle
          cx={size() / 2}
          cy={size() / 2}
          r={radius()}
          fill="none"
          stroke={props.isCompleted ? "#22c55e" : (props.color || "currentColor")}
          class={props.isCompleted ? "" : (props.isReceiving ? "text-secondary" : "text-primary")}
          stroke-width={strokeWidth()}
          stroke-linecap="round"
          stroke-dasharray={circumference()}
          stroke-dashoffset={offset()}
          style={{ transition: "stroke-dashoffset 0.3s ease-out" }}
        />
      </svg>
      <div class="absolute inset-0 flex items-center justify-center">
        <Show
          when={props.isCompleted}
          fallback={
            <span class="text-xs font-semibold">{Math.round(props.percent)}%</span>
          }
        >
          <FileCheck size={20} class="text-success" />
        </Show>
      </div>
    </div>
  );
};

// 速度可视化条
const SpeedBar: Component<{ speed: number; maxSpeed?: number }> = (props) => {
  const maxSpeed = () => props.maxSpeed || 10 * 1024 * 1024; // 默认 10MB/s
  const percent = () => Math.min((props.speed / maxSpeed()) * 100, 100);

  return (
    <div class="flex items-center gap-2">
      <Zap size={12} class="text-warning shrink-0" />
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-base-300/40">
        <Motion.div
          class="h-full rounded-full bg-warning"
          animate={{ width: `${percent()}%` }}
          transition={{ duration: 0.3, easing: "ease-out" }}
        />
      </div>
    </div>
  );
};

export const EnhancedTransferProgress: Component<EnhancedTransferProgressProps> = (
  props,
) => {
  const percent = () =>
    props.total > 0 ? Math.round((props.transferred / props.total) * 100) : 0;
  const speedStr = () => formatFileSize(props.speed) + "/s";

  const statusText = createMemo(() => {
    if (props.isCompleted) return t("receive.downloadComplete");
    if (props.isPending) return t("receive.connecting");
    return `${percent()}%`;
  });

  return (
    <Motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.4, easing: "ease-out" }}
      class="border-base-300/70 bg-base-100/80 relative overflow-hidden rounded-3xl border p-5 shadow-sm"
    >
      {/* 背景进度条装饰 */}
      <Show when={!props.isCompleted && !props.isPending}>
        <div class="absolute inset-x-0 bottom-0 h-0.5 bg-base-300/20">
          <Motion.div
            class="h-full rounded-full"
            classList={{
              "bg-secondary": props.isReceiving,
              "bg-primary": !props.isReceiving,
            }}
            animate={{ width: `${percent()}%` }}
            transition={{ duration: 0.3, easing: "ease-out" }}
          />
        </div>
      </Show>

      <div class="flex items-start gap-4">
        {/* 环形进度 */}
        <div class="shrink-0">
          <ProgressRing
            percent={percent()}
            isCompleted={props.isCompleted}
            isReceiving={props.isReceiving}
          />
        </div>

        <div class="min-w-0 flex-1">
          {/* 标题和状态 */}
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-base-content/55 text-[11px] font-semibold tracking-[0.2em] uppercase">
                {props.isReceiving ? t("common.receiving") : t("common.send")}
              </p>
              <Show when={props.title || props.fileName}>
                <p class="mt-1 truncate text-sm font-medium">
                  {props.fileName || props.title}
                </p>
              </Show>
              <div class="mt-2 flex items-center gap-2">
                <Motion.span
                  class="text-2xl font-bold"
                  animate={{ scale: props.isPending ? [1, 1.05, 1] : 1 }}
                  transition={{
                    duration: 1.5,
                    repeat: props.isPending ? Infinity : 0,
                  }}
                >
                  {statusText()}
                </Motion.span>
                <Show when={props.isCompleted}>
                  <Motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    class="badge badge-success gap-1 rounded-xl"
                  >
                    <CheckCircle2 size={12} />
                    {t("receive.downloadComplete")}
                  </Motion.span>
                </Show>
              </div>
            </div>

            <div class="text-right text-sm opacity-65">
              <Show
                when={!props.isCompleted && !props.isPending}
                fallback={
                  <Show when={props.isPending}>
                    <div class="flex items-center gap-1 text-xs">
                      <Clock size={12} class="animate-pulse" />
                      {t("receive.stackHint")}
                    </div>
                  </Show>
                }
              >
                <p class="font-medium">{speedStr()}</p>
                <p class="mt-1 text-xs">
                  {t("nearby.remaining", { time: formatEta(props.eta) })}
                </p>
              </Show>
            </div>
          </div>

          {/* 速度可视化 */}
          <Show when={!props.isCompleted && !props.isPending && props.speed > 0}>
            <div class="mt-3">
              <SpeedBar speed={props.speed} />
            </div>
          </Show>

          {/* 文件大小信息 */}
          <Show when={!props.isPending}>
            <div class="mt-3 flex items-center gap-2 text-xs opacity-60">
              <span>{formatFileSize(props.transferred)}</span>
              <span class="text-base-content/30">/</span>
              <span>{formatFileSize(props.total)}</span>
              <Show when={props.fileSize && props.fileSize !== props.total}>
                <span class="text-base-content/30">·</span>
                <span>{formatFileSize(props.fileSize)}</span>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* 取消按钮 */}
      <Show when={props.onCancel && !props.isCompleted}>
        <Motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => props.onCancel?.()}
          class="btn btn-ghost btn-sm text-error mt-4 w-full rounded-2xl"
        >
          <X size={14} class="mr-1" /> {t("common.cancel")}
        </Motion.button>
      </Show>
    </Motion.div>
  );
};

import { Component, For, Show, createMemo } from "solid-js";
import { formatFileSize } from "@sendme/ui";
import { Cloud, Download, Radio, X, Check, Bell } from "lucide-solid";
import { Motion, Presence } from "solid-motionone";
import { i18n } from "@sendme/shared";
import type { CloudTicket, IncomingRequest } from "~/bindings";
import { buildIncomingReminders } from "~/lib/transfer-ui";

const t = i18n.t;

interface IncomingReminderStackProps {
  isMobile: boolean;
  nearbyRequests: IncomingRequest[];
  cloudTickets: CloudTicket[];
  onOpenReceive: () => void;
  onAcceptNearby: () => void;
  onDeclineNearby: () => void;
  onAcceptCloud: (ticketId: string) => void;
  onDeclineCloud: (ticketId: string) => void;
}

export const IncomingReminderStack: Component<IncomingReminderStackProps> = (
  props,
) => {
  const reminders = createMemo(() =>
    buildIncomingReminders({
      nearbyRequests: props.nearbyRequests,
      cloudTickets: props.cloudTickets,
      maxVisible: 3,
    }),
  );

  const topReminder = createMemo(() => reminders().visible[0] ?? null);
  const stackedReminders = createMemo(() => reminders().visible.slice(1, 3));

  const topKindLabel = () =>
    topReminder()?.kind === "nearby" ? t("nearby.title") : t("receive.cloudQueue");

  const topMetaLabel = () => {
    const top = topReminder();
    if (!top) return "";
    const countLabel = t("nearby.fileCount", { count: top.fileCount });
    if (top.totalSize > 0) {
      return `${countLabel} · ${formatFileSize(top.totalSize)}`;
    }
    return countLabel;
  };

  const handleAccept = () => {
    const top = topReminder();
    if (!top) return;
    if (top.kind === "nearby") {
      props.onAcceptNearby();
      return;
    }
    props.onAcceptCloud(top.id);
  };

  const handleDecline = () => {
    const top = topReminder();
    if (!top) return;
    if (top.kind === "nearby") {
      props.onDeclineNearby();
      return;
    }
    props.onDeclineCloud(top.id);
  };

  return (
    <Presence>
      <Show when={topReminder()}>
        <Motion.div
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.9 }}
          transition={{ duration: 0.4, type: "spring", stiffness: 400, damping: 30 }}
          class={`pointer-events-none fixed z-40 ${
            props.isMobile ? "inset-x-3 bottom-24" : "bottom-6 right-6 w-[380px]"
          }`}
        >
          <div
            class="relative"
            style={{
              "padding-bottom": `${stackedReminders().length * 14}px`,
            }}
          >
            <For each={stackedReminders().slice().reverse()}>
              {(item, index) => {
                const depth = stackedReminders().length - index();
                return (
                  <Motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: `${1 - depth * 0.08}`, y: 0 }}
                    class="pointer-events-none absolute inset-x-2 bottom-0 rounded-[26px] border border-base-300/70 bg-base-100/70 shadow-lg backdrop-blur"
                    style={{
                      transform: `translateY(${depth * 14}px) scale(${1 - depth * 0.02})`,
                    }}
                  >
                    <div class="flex items-center gap-2 px-4 py-3 text-xs text-base-content/70">
                      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-200 text-base-content/70">
                        {item.kind === "nearby" ? <Radio size={14} /> : <Cloud size={14} />}
                      </span>
                      <span class="truncate font-medium">{item.title}</span>
                      <span class="truncate opacity-60">{item.fileLabel}</span>
                    </div>
                  </Motion.div>
                );
              }}
            </For>

            <Motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              class="pointer-events-auto relative rounded-[28px] border border-base-300/80 bg-base-100/95 p-4 shadow-2xl backdrop-blur-xl"
            >
              {/* 顶部装饰线 */}
              <div class="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent rounded-full" />

              <div class="flex items-start gap-3">
                <Motion.div
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary/12 text-secondary"
                >
                  {topReminder()!.kind === "nearby" ? <Radio size={20} /> : <Cloud size={20} />}
                </Motion.div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="badge badge-secondary badge-sm">{topKindLabel()}</span>
                    <Show when={reminders().hiddenCount > 0}>
                      <span class="badge badge-outline badge-sm">
                        +{reminders().hiddenCount} {t("receive.moreIncoming")}
                      </span>
                    </Show>
                  </div>
                  <p class="mt-2 truncate text-sm font-semibold">{topReminder()!.title}</p>
                  <p class="mt-1 text-xs text-base-content/65 line-clamp-2">
                    {topReminder()!.fileLabel}
                  </p>
                  <p class="mt-2 text-xs text-base-content/55">{topMetaLabel()}</p>
                </div>
                <Motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={props.onOpenReceive}
                  class="btn btn-ghost btn-sm rounded-xl px-3"
                >
                  <Download size={14} />
                  <span class="hidden sm:inline">{t("nearby.openReceive")}</span>
                </Motion.button>
              </div>

              <div class="mt-4 flex gap-2">
                <Motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleDecline}
                  class="btn btn-outline btn-sm flex-1 rounded-2xl gap-1"
                >
                  <X size={14} />
                  {t("nearby.decline")}
                </Motion.button>
                <Motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleAccept}
                  class="btn btn-secondary btn-sm flex-1 rounded-2xl gap-1"
                >
                  <Check size={14} />
                  {t("nearby.accept")}
                </Motion.button>
              </div>
            </Motion.div>
          </div>
        </Motion.div>
      </Show>
    </Presence>
  );
};

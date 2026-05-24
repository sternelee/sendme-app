import { Component, Show } from "solid-js";
import { Check, X, Loader2, Smartphone, Monitor } from "lucide-solid";
import { FileManifest } from "./FileManifest";
import { i18n } from "@sendme/shared";

const t = i18n.t;

interface IncomingRequestCardProps {
  request: {
    id: string;
    senderName: string;
    senderDeviceType?: string;
    files: Array<{ name: string; size: number }>;
    totalSize: number;
  };
  onAccept: () => void;
  onDecline: () => void;
  disabled?: boolean;
  state?: "pending" | "accepting" | "declining";
}

function SenderIcon(props: { deviceType?: string }) {
  const Icon =
    props.deviceType === "mobile" || props.deviceType === "android" || props.deviceType === "ios"
      ? Smartphone
      : Monitor;
  return <Icon size={22} />;
}

export const IncomingRequestCard: Component<IncomingRequestCardProps> = (
  props,
) => {
  return (
    <div class="bg-base-200 space-y-4 rounded-lg p-4">
      <div class="flex items-center gap-3">
        <div class="avatar placeholder">
          <div class="bg-secondary/20 text-secondary flex w-12 items-center justify-center rounded-full">
            <SenderIcon deviceType={props.request.senderDeviceType} />
          </div>
        </div>
        <div>
          <p class="font-medium">{props.request.senderName}</p>
          <p class="text-xs opacity-60">
            {props.request.senderDeviceType
              ? t("nearby.senderWantsToSendWithDevice", {
                  deviceType: props.request.senderDeviceType,
                })
              : t("nearby.senderWantsToSend")}
          </p>
        </div>
      </div>

      <FileManifest
        files={props.request.files}
        totalSize={props.request.totalSize}
        maxHeight="120px"
      />

      <Show when={props.state === "accepting"}>
        <div class="flex items-center justify-center py-2">
          <Loader2 size={20} class="text-primary mr-2 animate-spin" />
          <span class="text-sm">{t("nearby.accepting")}</span>
        </div>
      </Show>

      <Show when={props.state === "declining"}>
        <div class="flex items-center justify-center py-2">
          <Loader2 size={20} class="text-error mr-2 animate-spin" />
          <span class="text-sm">{t("nearby.declining")}</span>
        </div>
      </Show>

      <Show when={!props.state || props.state === "pending"}>
        <div class="flex gap-2">
          <button
            onClick={props.onDecline}
            disabled={props.disabled}
            class="btn btn-outline flex-1"
          >
            <X size={16} class="mr-1" /> {t("nearby.decline")}
          </button>
          <button
            onClick={props.onAccept}
            disabled={props.disabled}
            class="btn btn-secondary flex-1"
          >
            <Check size={16} class="mr-1" /> {t("nearby.accept")}
          </button>
        </div>
      </Show>
    </div>
  );
};

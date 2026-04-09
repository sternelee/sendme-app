import { Component } from "solid-js";
import { Loader2 } from "lucide-solid";
import { i18n } from "~/lib/i18n";

const t = i18n.t;

interface ConnectionWaitingProps {
  deviceName: string;
  onCancel: () => void;
}

export const ConnectionWaiting: Component<ConnectionWaitingProps> = (props) => {
  return (
    <div class="bg-base-200 space-y-4 rounded-lg p-6 text-center">
      <div class="flex justify-center">
        <div class="relative">
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="border-base-300 h-16 w-16 rounded-full border-4"></div>
          </div>
          <div class="relative flex h-16 w-16 items-center justify-center">
            <Loader2 size={32} class="text-primary animate-spin" />
          </div>
        </div>
      </div>
      <div class="space-y-1">
        <p class="font-medium">
          {t("nearby.waitingForAccept", { deviceName: props.deviceName })}
        </p>
        <p class="text-xs opacity-60">{t("nearby.waitingHint")}</p>
      </div>
      <button onClick={props.onCancel} class="btn btn-outline btn-sm">
        {t("common.cancel")}
      </button>
    </div>
  );
};

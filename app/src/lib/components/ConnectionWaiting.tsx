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
    <div class="border-base-300/70 bg-base-100/80 rounded-3xl border p-6 text-center shadow-sm">
      <div class="flex justify-center">
        <div class="relative">
          <div class="bg-primary/10 absolute inset-0 animate-ping rounded-full"></div>
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="border-base-300 h-16 w-16 rounded-full border-4"></div>
          </div>
          <div class="relative flex h-16 w-16 items-center justify-center">
            <Loader2 size={32} class="text-primary animate-spin" />
          </div>
        </div>
      </div>
      <div class="mt-4 space-y-2">
        <p class="text-lg font-semibold">
          {t("nearby.waitingForAccept", { deviceName: props.deviceName })}
        </p>
        <p class="text-base-content/60 text-sm leading-6">
          {t("nearby.waitingHint")}
        </p>
      </div>
      <button
        onClick={props.onCancel}
        class="btn btn-outline btn-sm mt-4 rounded-2xl"
      >
        {t("common.cancel")}
      </button>
    </div>
  );
};

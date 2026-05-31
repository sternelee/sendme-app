import { Component } from "solid-js";
import { Loader2, Radio, X } from "lucide-solid";
import { Motion } from "solid-motionone";
import { i18n } from "@sendme/shared";

const t = i18n.t;

interface ConnectionWaitingProps {
  deviceName: string;
  onCancel: () => void;
}

export const ConnectionWaiting: Component<ConnectionWaitingProps> = (props) => {
  return (
    <Motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, easing: "ease-out" }}
      class="border-base-300/70 bg-base-100/80 rounded-3xl border p-6 text-center shadow-sm relative overflow-hidden"
    >
      {/* 背景脉冲装饰 */}
      <div class="absolute inset-0 pointer-events-none">
        <Motion.div
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5"
          animate={{ 
            width: [200, 280, 200],
            height: [200, 280, 200],
            opacity: [0.3, 0.1, 0.3]
          }}
          transition={{ duration: 2, repeat: Infinity, easing: "ease-in-out" }}
        />
      </div>

      <div class="relative">
        <div class="flex justify-center">
          <div class="relative">
            {/* 多层脉冲环 */}
            <Motion.div
              class="absolute inset-0 rounded-full bg-primary/10"
              animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity, easing: "ease-out" }}
            />
            <Motion.div
              class="absolute inset-[-8px] rounded-full bg-primary/5"
              animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity, easing: "ease-out", delay: 0.3 }}
            />
            
            <div class="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
              <Loader2 size={28} class="text-primary animate-spin" />
            </div>
          </div>
        </div>

        <div class="mt-5 space-y-2">
          <div class="flex items-center justify-center gap-2">
            <Radio size={16} class="text-primary animate-pulse" />
            <p class="text-lg font-semibold">
              {t("nearby.waitingForAccept", { deviceName: props.deviceName })}
            </p>
          </div>
          <p class="text-base-content/60 text-sm leading-6 max-w-xs mx-auto">
            {t("nearby.waitingHint")}
          </p>
        </div>

        {/* 进度指示器 */}
        <div class="mt-4 flex justify-center gap-1">
          <Motion.div
            class="w-2 h-2 rounded-full bg-primary"
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: 0 }}
          />
          <Motion.div
            class="w-2 h-2 rounded-full bg-primary"
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: 0.2 }}
          />
          <Motion.div
            class="w-2 h-2 rounded-full bg-primary"
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: 0.4 }}
          />
        </div>

        <Motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={props.onCancel}
          class="btn btn-outline btn-sm mt-5 rounded-2xl gap-1"
        >
          <X size={14} />
          {t("common.cancel")}
        </Motion.button>
      </div>
    </Motion.div>
  );
};

import { Component, Show, createSignal, onMount, onCleanup } from "solid-js";
import { X, Scan, Camera, Flashlight, Image, CheckCircle2 } from "lucide-solid";
import { Motion, Presence } from "solid-motionone";
import { i18n } from "@sendme/shared";

const t = i18n.t;

interface ScanOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (content: string) => void;
  onPickFromGallery?: () => void;
}

// 手动输入模态框
const ManualInputModal: Component<{
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (content: string) => void;
}> = (props) => {
  const [inputValue, setInputValue] = createSignal("");

  const handleSubmit = () => {
    const value = inputValue().trim();
    if (value) {
      props.onSubmit(value);
      setInputValue("");
    }
  };

  return (
    <Presence>
      <Show when={props.isOpen}>
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          class="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={props.onClose}
        >
          <Motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            class="bg-base-100 w-full max-w-sm rounded-3xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 class="mb-4 text-lg font-semibold">
              {t("receive.enterTicketManually")}
            </h3>
            <input
              type="text"
              value={inputValue()}
              onInput={(e) => setInputValue(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={t("common.pasteTicket")}
              class="input input-bordered mb-4 w-full rounded-xl"
              autofocus
            />
            <div class="flex gap-2">
              <button
                onClick={props.onClose}
                class="btn btn-ghost flex-1 rounded-xl"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSubmit}
                class="btn btn-primary flex-1 rounded-xl"
                disabled={!inputValue().trim()}
              >
                {t("common.confirm")}
              </button>
            </div>
          </Motion.div>
        </Motion.div>
      </Show>
    </Presence>
  );
};

// 扫描动画组件
const ScanAnimation: Component = () => {
  return (
    <div class="pointer-events-none absolute inset-0">
      {/* 扫描线动画 */}
      <Motion.div
        class="bg-primary absolute right-0 left-0 h-0.5 shadow-[0_0_12px_rgba(var(--color-primary),0.6)]"
        animate={{ top: ["10%", "90%", "10%"] }}
        transition={{ duration: 2.5, repeat: Infinity, easing: "ease-in-out" }}
      />

      {/* 四角装饰 */}
      <div class="absolute top-[15%] left-[15%] h-8 w-8">
        <div class="bg-primary absolute top-0 left-0 h-0.5 w-full" />
        <div class="bg-primary absolute top-0 left-0 h-full w-0.5" />
      </div>
      <div class="absolute top-[15%] right-[15%] h-8 w-8">
        <div class="bg-primary absolute top-0 right-0 h-0.5 w-full" />
        <div class="bg-primary absolute top-0 right-0 h-full w-0.5" />
      </div>
      <div class="absolute bottom-[15%] left-[15%] h-8 w-8">
        <div class="bg-primary absolute bottom-0 left-0 h-0.5 w-full" />
        <div class="bg-primary absolute bottom-0 left-0 h-full w-0.5" />
      </div>
      <div class="absolute right-[15%] bottom-[15%] h-8 w-8">
        <div class="bg-primary absolute right-0 bottom-0 h-0.5 w-full" />
        <div class="bg-primary absolute right-0 bottom-0 h-full w-0.5" />
      </div>

      {/* 脉冲动画 */}
      <div class="absolute inset-[20%] flex items-center justify-center">
        <Motion.div
          class="border-primary/30 absolute inset-0 rounded-lg border-2"
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, easing: "ease-out" }}
        />
      </div>
    </div>
  );
};

// 手电筒按钮
const FlashlightButton: Component<{ onToggle: (on: boolean) => void }> = (
  props,
) => {
  const [isOn, setIsOn] = createSignal(false);

  const toggle = () => {
    const newState = !isOn();
    setIsOn(newState);
    props.onToggle(newState);
  };

  return (
    <Motion.button
      whileTap={{ scale: 0.9 }}
      onClick={toggle}
      class={`rounded-full p-3 backdrop-blur-md transition-colors ${
        isOn() ? "bg-warning/20 text-warning" : "bg-base-100/20 text-white/80"
      }`}
    >
      <Flashlight size={22} />
    </Motion.button>
  );
};

export const ScanOverlay: Component<ScanOverlayProps> = (props) => {
  const [scanStatus, setScanStatus] = createSignal<
    "scanning" | "detected" | "error"
  >("scanning");
  const [detectedContent, setDetectedContent] = createSignal("");
  const [showManualInput, setShowManualInput] = createSignal(false);

  let scanTimer: ReturnType<typeof setTimeout>;
  let closeTimer: ReturnType<typeof setTimeout>;

  const simulateScan = () => {
    scanTimer = setTimeout(() => {
      setScanStatus("scanning");
    }, 500);
  };

  onMount(() => {
    if (props.isOpen) {
      simulateScan();
    }
  });

  onCleanup(() => {
    clearTimeout(scanTimer);
    clearTimeout(closeTimer);
  });

  const handleManualInput = (content: string) => {
    setDetectedContent(content);
    setScanStatus("detected");
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      props.onScan(content);
      props.onClose();
    }, 300);
  };

  return (
    <>
      <Presence>
        <Show when={props.isOpen}>
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            class="fixed inset-0 z-[100] bg-black"
          >
            {/* 相机预览区域（实际项目中替换为真实相机预览） */}
            <div class="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60">
              <ScanAnimation />
            </div>

            {/* 顶部工具栏 */}
            <div class="safe-area-top absolute top-0 right-0 left-0 z-10 p-4">
              <div class="flex items-center justify-between">
                <Motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={props.onClose}
                  class="rounded-full bg-black/30 p-2 text-white backdrop-blur-md"
                  aria-label={t("common.close")}
                >
                  <X size={24} />
                </Motion.button>

                <div class="text-sm font-medium text-white/90">
                  {scanStatus() === "scanning" && t("receive.scanning")}
                  {scanStatus() === "detected" && t("receive.qrDetected")}
                </div>

                <div class="w-10" />
              </div>
            </div>

            {/* 扫描状态指示器 */}
            <div class="absolute top-1/4 right-0 left-0 flex justify-center">
              <Show when={scanStatus() === "scanning"}>
                <Motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  class="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm text-white/90 backdrop-blur-md"
                >
                  <Scan size={16} class="animate-pulse" />
                  <span>{t("receive.alignQrCode")}</span>
                </Motion.div>
              </Show>

              <Show when={scanStatus() === "detected"}>
                <Motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  class="bg-success/30 text-success flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium backdrop-blur-md"
                >
                  <CheckCircle2 size={16} />
                  <span>{t("receive.qrDetected")}</span>
                </Motion.div>
              </Show>
            </div>

            {/* 底部工具栏 */}
            <div class="safe-area-bottom absolute right-0 bottom-0 left-0 z-10 p-6">
              <div class="flex items-center justify-center gap-8">
                <Show when={props.onPickFromGallery}>
                  <Motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={props.onPickFromGallery}
                    class="flex flex-col items-center gap-1 text-white/70"
                  >
                    <div class="rounded-full bg-white/10 p-3 backdrop-blur-md">
                      <Image size={22} />
                    </div>
                    <span class="text-xs">{t("receive.gallery")}</span>
                  </Motion.button>
                </Show>

                {/* 扫描按钮 */}
                <Motion.button
                  whileTap={{ scale: 0.95 }}
                  class="relative flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/30"
                  aria-label={t("receive.scanQr")}
                >
                  <div class="flex h-12 w-12 items-center justify-center rounded-full bg-white">
                    <Camera size={24} class="text-black" />
                  </div>
                </Motion.button>

                <FlashlightButton onToggle={(_on) => {}} />
              </div>
            </div>

            {/* 手动输入快捷入口 */}
            <div class="absolute right-0 bottom-32 left-0 flex justify-center">
              <Motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowManualInput(true)}
                class="rounded-full bg-white/10 px-4 py-2 text-sm text-white/80 backdrop-blur-md"
              >
                {t("receive.enterTicketManually")}
              </Motion.button>
            </div>
          </Motion.div>
        </Show>
      </Presence>

      <ManualInputModal
        isOpen={showManualInput()}
        onClose={() => setShowManualInput(false)}
        onSubmit={(content) => {
          setShowManualInput(false);
          handleManualInput(content);
        }}
      />
    </>
  );
};

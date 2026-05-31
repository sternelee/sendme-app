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
          class="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={props.onClose}
        >
          <Motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            class="bg-base-100 rounded-3xl shadow-2xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 class="text-lg font-semibold mb-4">{t("receive.enterTicketManually")}</h3>
            <input
              type="text"
              value={inputValue()}
              onInput={(e) => setInputValue(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={t("common.pasteTicket")}
              class="input input-bordered w-full rounded-xl mb-4"
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
    <div class="absolute inset-0 pointer-events-none">
      {/* 扫描线动画 */}
      <Motion.div
        class="absolute left-0 right-0 h-0.5 bg-primary shadow-[0_0_12px_rgba(var(--color-primary),0.6)]"
        animate={{ top: ["10%", "90%", "10%"] }}
        transition={{ duration: 2.5, repeat: Infinity, easing: "ease-in-out" }}
      />

      {/* 四角装饰 */}
      <div class="absolute top-[15%] left-[15%] w-8 h-8">
        <div class="absolute top-0 left-0 w-full h-0.5 bg-primary"/>
        <div class="absolute top-0 left-0 w-0.5 h-full bg-primary"/>
      </div>
      <div class="absolute top-[15%] right-[15%] w-8 h-8">
        <div class="absolute top-0 right-0 w-full h-0.5 bg-primary"/>
        <div class="absolute top-0 right-0 w-0.5 h-full bg-primary"/>
      </div>
      <div class="absolute bottom-[15%] left-[15%] w-8 h-8">
        <div class="absolute bottom-0 left-0 w-full h-0.5 bg-primary"/>
        <div class="absolute bottom-0 left-0 w-0.5 h-full bg-primary"/>
      </div>
      <div class="absolute bottom-[15%] right-[15%] w-8 h-8">
        <div class="absolute bottom-0 right-0 w-full h-0.5 bg-primary"/>
        <div class="absolute bottom-0 right-0 w-0.5 h-full bg-primary"/>
      </div>

      {/* 脉冲动画 */}
      <div class="absolute inset-[20%] flex items-center justify-center">
        <Motion.div
          class="border-2 border-primary/30 rounded-lg absolute inset-0"
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, easing: "ease-out" }}
        />
      </div>
    </div>
  );
};

// 手电筒按钮
const FlashlightButton: Component<{ onToggle: (on: boolean) => void }> = (props) => {
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
      class={`p-3 rounded-full backdrop-blur-md transition-colors ${
        isOn()
          ? "bg-warning/20 text-warning"
          : "bg-base-100/20 text-white/80"
      }`}
    >
      <Flashlight size={22} />
    </Motion.button>
  );
};

export const ScanOverlay: Component<ScanOverlayProps> = (props) => {
  const [scanStatus, setScanStatus] = createSignal<"scanning" | "detected" | "error">("scanning");
  const [detectedContent, setDetectedContent] = createSignal("");
  const [showManualInput, setShowManualInput] = createSignal(false);

  let scanTimer: ReturnType<typeof setTimeout>;

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
  });

  const handleManualInput = (content: string) => {
    setDetectedContent(content);
    setScanStatus("detected");
    setTimeout(() => {
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
          <div class="absolute top-0 left-0 right-0 z-10 p-4 safe-area-top">
            <div class="flex items-center justify-between">
              <Motion.button
                whileTap={{ scale: 0.9 }}
                onClick={props.onClose}
                class="p-2 rounded-full bg-black/30 backdrop-blur-md text-white"
              >
                <X size={24} />
              </Motion.button>

              <div class="text-white/90 text-sm font-medium">
                {scanStatus() === "scanning" && t("receive.scanning")}
                {scanStatus() === "detected" && t("receive.qrDetected")}
              </div>

              <div class="w-10" />
            </div>
          </div>

          {/* 扫描状态指示器 */}
          <div class="absolute top-1/4 left-0 right-0 flex justify-center">
            <Show when={scanStatus() === "scanning"}>
              <Motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                class="flex items-center gap-2 px-4 py-2 rounded-full bg-black/40 backdrop-blur-md text-white/90 text-sm"
              >
                <Scan size={16} class="animate-pulse" />
                <span>{t("receive.alignQrCode")}</span>
              </Motion.div>
            </Show>

            <Show when={scanStatus() === "detected"}>
              <Motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                class="flex items-center gap-2 px-4 py-2 rounded-full bg-success/30 backdrop-blur-md text-success text-sm font-medium"
              >
                <CheckCircle2 size={16} />
                <span>{t("receive.qrDetected")}</span>
              </Motion.div>
            </Show>
          </div>

          {/* 底部工具栏 */}
          <div class="absolute bottom-0 left-0 right-0 z-10 p-6 safe-area-bottom">
            <div class="flex items-center justify-center gap-8">
              <Show when={props.onPickFromGallery}>
                <Motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={props.onPickFromGallery}
                  class="flex flex-col items-center gap-1 text-white/70"
                >
                  <div class="p-3 rounded-full bg-white/10 backdrop-blur-md">
                    <Image size={22} />
                  </div>
                  <span class="text-xs">{t("receive.gallery")}</span>
                </Motion.button>
              </Show>

              {/* 扫描按钮 */}
              <Motion.button
                whileTap={{ scale: 0.95 }}
                class="relative w-16 h-16 rounded-full border-4 border-white/30 flex items-center justify-center"
              >
                <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center">
                  <Camera size={24} class="text-black" />
                </div>
              </Motion.button>

              <FlashlightButton onToggle={(on) => {
                console.log("Flashlight:", on);
              }} />
            </div>
          </div>

          {/* 手动输入快捷入口 */}
          <div class="absolute bottom-32 left-0 right-0 flex justify-center">
            <Motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowManualInput(true)}
              class="px-4 py-2 rounded-full bg-white/10 backdrop-blur-md text-white/80 text-sm"
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
  </>);
};

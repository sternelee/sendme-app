import { Component, Show, For, createSignal, onCleanup } from "solid-js";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Info, 
  X,
  Bell,
  FileText,
  Download,
  Send
} from "lucide-solid";
import { Motion, Presence, AnimatePresence } from "solid-motionone";
import { i18n } from "@sendme/shared";
import { triggerHaptic } from "~/lib/haptics";

const t = i18n.t;

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastNotificationProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const ToastIcon: Component<{ type: ToastType }> = (props) => {
  switch (props.type) {
    case "success":
      return <CheckCircle2 size={20} class="text-success" />;
    case "error":
      return <XCircle size={20} class="text-error" />;
    case "warning":
      return <AlertTriangle size={20} class="text-warning" />;
    case "info":
      return <Info size={20} class="text-info" />;
  }
};

const ToastColors: Record<ToastType, string> = {
  success: "border-success/20 bg-success/5",
  error: "border-error/20 bg-error/5",
  warning: "border-warning/20 bg-warning/5",
  info: "border-info/20 bg-info/5",
};

// 单个 Toast 组件
const ToastItem: Component<{
  toast: ToastMessage;
  onDismiss: () => void;
  index: number;
}> = (props) => {
  const [progress, setProgress] = createSignal(100);
  let timer: ReturnType<typeof setInterval>;
  let startTime = Date.now();
  const duration = props.toast.duration || 4000;

  // 启动进度条
  const startProgress = () => {
    timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        props.onDismiss();
      }
    }, 16);
  };

  startProgress();

  onCleanup(() => {
    clearInterval(timer);
  });

  return (
    <Motion.div
      initial={{ opacity: 0, x: 50, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.9 }}
      transition={{ duration: 0.3, type: "spring", stiffness: 400, damping: 30 }}
      class={`relative overflow-hidden rounded-2xl border p-4 shadow-lg backdrop-blur-xl ${ToastColors[props.toast.type]}`}
    >
      {/* 进度条 */}
      <div class="absolute bottom-0 left-0 h-0.5 bg-current opacity-20" style={{ width: `${progress()}%` }} />
      
      <div class="flex items-start gap-3">
        <div class="shrink-0 mt-0.5">
          <ToastIcon type={props.toast.type} />
        </div>
        
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">{props.toast.title}</p>
          <Show when={props.toast.message}>
            <p class="text-xs text-base-content/60 mt-1">{props.toast.message}</p>
          </Show>
          
          <Show when={props.toast.action}>
            <Motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                props.toast.action?.onClick();
                props.onDismiss();
              }}
              class="mt-2 text-xs font-medium text-primary hover:underline"
            >
              {props.toast.action?.label}
            </Motion.button>
          </Show>
        </div>
        
        <Motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={props.onDismiss}
          class="shrink-0 p-1 rounded-lg hover:bg-base-300/50 transition-colors"
        >
          <X size={14} />
        </Motion.button>
      </div>
    </Motion.div>
  );
};

// Toast 通知容器
export const ToastNotification: Component<ToastNotificationProps> = (props) => {
  return (
    <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <Presence>
        <For each={props.toasts}>
          {(toast, index) => (
            <div class="pointer-events-auto">
              <ToastItem
                toast={toast}
                onDismiss={() => props.onDismiss(toast.id)}
                index={index()}
              />
            </div>
          )}
        </For>
      </Presence>
    </div>
  );
};

// 创建 Toast 状态管理
export function createToastManager() {
  const [toasts, setToasts] = createSignal<ToastMessage[]>([]);

  const addToast = (toast: Omit<ToastMessage, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = { ...toast, id };
    
    setToasts((prev) => [...prev, newToast]);
    
    // 触觉反馈
    triggerHaptic(toast.type === "error" ? "error" : toast.type === "success" ? "success" : "light");
    
    // 自动移除
    const duration = toast.duration || 4000;
    setTimeout(() => {
      dismissToast(id);
    }, duration);
    
    return id;
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const success = (title: string, message?: string) =>
    addToast({ type: "success", title, message });

  const error = (title: string, message?: string) =>
    addToast({ type: "error", title, message, duration: 6000 });

  const warning = (title: string, message?: string) =>
    addToast({ type: "warning", title, message });

  const info = (title: string, message?: string) =>
    addToast({ type: "info", title, message });

  return {
    toasts,
    addToast,
    dismissToast,
    success,
    error,
    warning,
    info,
  };
}

// 文件传输专用 Toast
export function createTransferToast() {
  const manager = createToastManager();

  const transferStarted = (fileName: string) =>
    manager.info(
      t("toast.transferStarted"),
      fileName,
    );

  const transferComplete = (fileName: string) =>
    manager.success(
      t("toast.transferComplete"),
      fileName,
    );

  const transferFailed = (fileName: string, error: string) =>
    manager.error(
      t("toast.transferFailed"),
      `${fileName}: ${error}`,
    );

  const transferCancelled = (fileName: string) =>
    manager.warning(
      t("toast.transferCancelled"),
      fileName,
    );

  return {
    ...manager,
    transferStarted,
    transferComplete,
    transferFailed,
    transferCancelled,
  };
}

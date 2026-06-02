// 触觉反馈系统 - 优先使用 Tauri 原生插件，降级到 Web Vibration API
import {
  impactFeedback,
  notificationFeedback,
} from "@tauri-apps/plugin-haptics";
import { platform } from "@tauri-apps/plugin-os";
import { debugInfo } from "./debug-log";

// 支持的触觉类型
export type HapticType =
  | "light" // 轻微点击
  | "medium" // 中等点击
  | "heavy" // 强烈点击
  | "success" // 成功
  | "warning" // 警告
  | "error" // 错误
  | "selection"; // 选择变更

let isMobile = false;
try {
  const p = await platform();
  isMobile = p === "android" || p === "ios";
} catch {
  // Not in Tauri environment
}

// 检查 Web Vibration API 是否可用
function isWebVibrateSupported(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

// Web Vibration 降级方案
function webVibrate(type: HapticType) {
  if (!isWebVibrateSupported()) return;

  try {
    switch (type) {
      case "light":
        navigator.vibrate(10);
        break;
      case "medium":
        navigator.vibrate(20);
        break;
      case "heavy":
        navigator.vibrate([30, 50, 30]);
        break;
      case "success":
        navigator.vibrate([10, 30, 20]);
        break;
      case "warning":
        navigator.vibrate([20, 40, 20, 40, 20]);
        break;
      case "error":
        navigator.vibrate([50, 30, 50, 30, 50]);
        break;
      case "selection":
        navigator.vibrate(5);
        break;
      default:
        navigator.vibrate(10);
    }
  } catch (e) {
    console.warn("Web vibration failed:", e);
  }
}

// 执行触觉反馈 - 优先 Tauri 插件，降级到 Web Vibration
export async function triggerHaptic(type: HapticType = "light") {
  if (!isMobile && !isWebVibrateSupported()) {
    return;
  }

  // 优先使用 Tauri 原生插件（移动端）
  if (isMobile) {
    try {
      const impactStyle =
        type === "light" || type === "selection"
          ? "light"
          : type === "medium" || type === "success"
            ? "medium"
            : "heavy";

      const notificationType =
        type === "success"
          ? "success"
          : type === "warning"
            ? "warning"
            : type === "error"
              ? "error"
              : null;

      if (notificationType) {
        await notificationFeedback(notificationType);
      } else {
        await impactFeedback(impactStyle);
      }

      debugInfo("haptics", `Triggered ${type} haptic via Tauri plugin`);
      return;
    } catch {
      // Tauri plugin 失败，降级到 Web Vibration
    }
  }

  // 降级到 Web Vibration API
  webVibrate(type);
  debugInfo("haptics", `Triggered ${type} haptic via Web Vibration API`);
}

// 同步版本的触觉反馈（用于不等待的场景）
export function triggerHapticSync(type: HapticType = "light") {
  triggerHaptic(type).catch(() => {
    webVibrate(type);
  });
}

// 触觉反馈包装器 - 用于事件处理
export function withHaptic<T extends (...args: unknown[]) => unknown>(
  fn: T,
  type: HapticType = "light",
): T {
  return ((...args: unknown[]) => {
    triggerHapticSync(type);
    return fn(...args);
  }) as T;
}

import {
  impactFeedback,
  notificationFeedback,
} from "@tauri-apps/plugin-haptics";
import { platform } from "@tauri-apps/plugin-os";

let isMobile = false;
try {
  const p = platform();
  isMobile = p === "android" || p === "ios";
} catch {
  // Not in Tauri environment
}

export async function hapticImpact(
  style: "light" | "medium" | "heavy" = "light",
) {
  if (!isMobile) return;
  try {
    await impactFeedback(style);
  } catch {
    // Silently ignore haptics errors
  }
}

export async function hapticNotification(
  type: "success" | "warning" | "error" = "success",
) {
  if (!isMobile) return;
  try {
    await notificationFeedback(type);
  } catch {
    // Silently ignore haptics errors
  }
}

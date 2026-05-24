import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "solid-sonner";
import { i18n } from "@sendme/shared";
import {
  FileText,
  FileImage,
  FileArchive,
  FileCode,
} from "lucide-solid";
import { getFileIcon, getDisplayName } from "@sendme/ui";
import type { Component } from "solid-js";

const t = i18n.t;

export async function copyToClipboard(text: string): Promise<void> {
  try {
    try {
      await writeText(text);
    } catch (tauriErr) {
      console.warn("Tauri clipboard write failed, falling back:", tauriErr);
      await navigator.clipboard.writeText(text);
    }
    toast.success(t("common.copied"));
  } catch (error) {
    console.error("Clipboard write failed:", error);
    toast.error(String(error));
  }
}

export async function pasteTicketFromClipboard(): Promise<string | null> {
  try {
    let text: string;
    try {
      text = await readText();
    } catch (tauriErr) {
      console.warn("Tauri clipboard read failed, falling back:", tauriErr);
      text = await navigator.clipboard.readText();
    }
    text = text.trim();
    if (!text) {
      toast.error(t("receive.clipboardError"));
      return null;
    }
    return text;
  } catch (error) {
    console.error("Clipboard read failed:", error);
    toast.error(t("receive.clipboardError"));
    return null;
  }
}

export async function nativeShare(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !("share" in navigator)) return;
  try {
    await navigator.share?.({ text });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return;
    toast.error(String(error));
  }
}

export function formatEta(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return "< 1 min";
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
  return `~${Math.round(seconds / 3600)} hr`;
}

export function getFileIconComponent(
  path: string,
): Component<{ size?: number; class?: string }> {
  const iconName = getFileIcon(getDisplayName(path));
  switch (iconName) {
    case "FileImage":
      return FileImage;
    case "FileArchive":
      return FileArchive;
    case "FileCode":
      return FileCode;
    default:
      return FileText;
  }
}

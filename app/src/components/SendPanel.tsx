import { Component, Show, createEffect } from "solid-js";
import { Copy, Share2, Smartphone, FileText, Loader2 } from "lucide-solid";
import QRCode from "qrcode";
import { getDisplayName } from "@sendme/ui";
import { i18n } from "@sendme/shared";
import { useGlobalStore } from "~/lib/store";
import { DropZone } from "~/lib/components/DropZone";
import { send_file, send_text } from "~/bindings";
import { toast } from "solid-sonner";

const t = i18n.t;

interface SendPanelProps {
  isMobile: boolean;
  showQrCode: boolean;
  setShowQrCode: (v: boolean) => void;
  onCopy: (text: string) => Promise<void>;
  onShare: (text: string) => Promise<void>;
  onTransferComplete?: () => void;
}

export const SendPanel: Component<SendPanelProps> = (props) => {
  const globalStore = useGlobalStore();

  const sendPath = () => globalStore.send.state().path;
  const sendFileSize = () => globalStore.send.state().fileSize;
  const sendTicket = () => globalStore.send.state().ticket;
  const sendTicketQrCode = () => globalStore.send.state().ticketQrCode;
  const isSending = () => globalStore.send.state().isSending;
  const textContent = () => globalStore.send.state().textContent;
  const isTextMode = () => globalStore.send.state().isTextMode;

  let debounceTimer: ReturnType<typeof setTimeout>;

  async function autoGenerateTicket() {
    if (isTextMode() && !textContent().trim()) return;
    if (!isTextMode() && !sendPath()) return;

    globalStore.send.setIsSending(true);
    try {
      const result = isTextMode()
        ? await send_text({
            text: textContent().trim(),
            ticket_type: "relay_and_addresses",
          })
        : await send_file({
            path: sendPath(),
            ticket_type: "relay_and_addresses",
          });
      globalStore.send.setTicket(result);
      globalStore.send.setTicketQrCode(
        await QRCode.toDataURL(result, {
          errorCorrectionLevel: "H",
          width: 280,
        }),
      );
      props.onTransferComplete?.();
    } catch (e) {
      toast.error(t("send.failed") + `: ${e}`);
    } finally {
      globalStore.send.setIsSending(false);
    }
  }

  function handleFilesSelected(
    files: Array<{ name: string; size: number; path: string }>,
  ) {
    if (files.length > 0) {
      globalStore.send.setPath(files[0].path);
      globalStore.send.setFileSize(files[0].size);
      globalStore.send.setTicket("");
      globalStore.send.setIsTextMode(false);
      globalStore.send.setIsFolder(false);
      autoGenerateTicket();
    }
  }

  function handleRemoveFile() {
    globalStore.send.setPath("");
    globalStore.send.setFileSize(0);
    globalStore.send.setTicket("");
    globalStore.send.setTicketQrCode("");
  }

  function handleTextInput(value: string) {
    globalStore.send.setTextContent(value);
    globalStore.send.setTicket("");
    globalStore.send.setTicketQrCode("");
    clearTimeout(debounceTimer);
    if (value.trim()) {
      debounceTimer = setTimeout(() => autoGenerateTicket(), 800);
    }
  }

  createEffect(() => {
    // Cleanup timer on unmount
    return () => clearTimeout(debounceTimer);
  });

  return (
    <div class="space-y-4">
      {/* Input area */}
      <Show
        when={isTextMode()}
        fallback={
          <div class="grid min-w-0 gap-3">
            <DropZone
              files={
                sendPath()
                  ? [
                      {
                        name: getDisplayName(sendPath()),
                        size: sendFileSize(),
                        path: sendPath(),
                      },
                    ]
                  : []
              }
              onFilesSelected={handleFilesSelected}
              onRemoveFile={handleRemoveFile}
            />
          </div>
        }
      >
        <textarea
          value={textContent()}
          onInput={(e) => handleTextInput(e.currentTarget.value)}
          placeholder={t("text.placeholder")}
          class="textarea textarea-bordered bg-base-100/75 min-h-48 w-full rounded-3xl p-4"
        />
      </Show>

      {/* Selected file summary (always visible when file selected) */}
      <Show when={!isTextMode() && sendPath()}>
        <div class="flex items-center gap-3 rounded-2xl border border-base-300/50 bg-base-200/40 px-4 py-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileText size={18} />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{getDisplayName(sendPath())}</p>
            <p class="text-xs opacity-50">{sendFileSize() > 0 ? `${(sendFileSize() / 1024 / 1024).toFixed(2)} MB` : ""}</p>
          </div>
          <button
            onClick={handleRemoveFile}
            class="btn btn-ghost btn-xs btn-circle shrink-0"
          >
            ✕
          </button>
        </div>
      </Show>

      {/* Generating state */}
      <Show when={isSending() && !sendTicket()}>
        <div class="surface-card flex items-center justify-center gap-3 py-8">
          <Loader2 size={20} class="animate-spin text-primary" />
          <span class="text-sm opacity-60">{t("send.title")}...</span>
        </div>
      </Show>

      {/* Share panel - auto-shown after ticket generated */}
      <Show when={sendTicket()}>
        <div class="surface-card space-y-4 p-5">
          <div class="flex items-center gap-2">
            <Smartphone size={16} class="text-success" />
            <p class="text-sm font-semibold">{t("send.title")}</p>
          </div>

          <Show when={sendTicketQrCode()}>
            <div class="flex justify-center">
              <div class="rounded-xl bg-white p-3">
                <img
                  src={sendTicketQrCode()}
                  alt="QR"
                  class="h-48 w-48"
                />
              </div>
            </div>
          </Show>

          <div class="bg-base-300/50 overflow-hidden rounded-xl p-3">
            <code class="text-primary font-mono text-xs break-all">
              {sendTicket()}
            </code>
          </div>

          <div class="flex gap-2">
            <button
              onClick={() => props.onCopy(sendTicket())}
              class="btn btn-outline btn-sm flex-1 rounded-xl"
            >
              <Copy size={14} /> {t("common.copy")}
            </button>
            <Show
              when={
                typeof navigator !== "undefined" && "share" in navigator
              }
            >
              <button
                onClick={() => props.onShare(sendTicket())}
                class="btn btn-outline btn-sm flex-1 rounded-xl"
              >
                <Share2 size={14} /> {t("common.share")}
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

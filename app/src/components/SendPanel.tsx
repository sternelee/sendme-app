import { Component, Show, createEffect } from "solid-js";
import { FileText, Link2, Loader2, Sparkles } from "lucide-solid";
import QRCode from "qrcode";
import { getDisplayName } from "@sendme/ui";
import { i18n } from "@sendme/shared";
import { Motion } from "solid-motionone";
import { useGlobalStore } from "~/lib/store";
import { DropZone } from "~/lib/components/DropZone";
import { ShareTicketCard } from "~/lib/components/ShareTicketCard";
import { send_file, send_text } from "~/bindings";
import { pickPrimarySendSelection } from "~/lib/transfer-ui";
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

  let requestVersion = 0;

  // Tickets are generated on demand now: picking a file no longer fires an
  // iroh share before the user has chosen how (and to whom) to send. Direct
  // recipients (nearby / devices / friends) create their own ticket when the
  // transfer actually starts.
  async function generateTicket() {
    if (isTextMode() && !textContent().trim()) return;
    if (!isTextMode() && !sendPath()) return;

    const currentRequest = ++requestVersion;
    globalStore.send.setIsSending(true);
    globalStore.send.setTicket("");
    globalStore.send.setTicketQrCode("");

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

      const qrCode = await QRCode.toDataURL(result, {
        errorCorrectionLevel: "H",
        width: 280,
      });

      if (currentRequest !== requestVersion) return;

      globalStore.send.setTicket(result);
      globalStore.send.setTicketQrCode(qrCode);
      props.setShowQrCode(!props.isMobile);
      props.onTransferComplete?.();
    } catch (e) {
      if (currentRequest !== requestVersion) return;
      toast.error(t("send.failed") + `: ${e}`);
    } finally {
      if (currentRequest === requestVersion) {
        globalStore.send.setIsSending(false);
      }
    }
  }

  function handleFilesSelected(
    files: Array<{ name: string; size: number; path: string }>,
  ) {
    const selection = pickPrimarySendSelection(files);
    if (!selection.primary) return;

    requestVersion += 1;
    globalStore.send.setPath(selection.primary.path);
    globalStore.send.setFileSize(selection.primary.size);
    globalStore.send.setTicket("");
    globalStore.send.setTicketQrCode("");
    globalStore.send.setIsTextMode(false);
    globalStore.send.setIsFolder(false);
    props.setShowQrCode(!props.isMobile);

    if (selection.overflowCount > 0) {
      toast.info(t("send.firstFileOnly"));
    }
  }

  function handleRemoveFile() {
    requestVersion += 1;
    globalStore.send.setPath("");
    globalStore.send.setFileSize(0);
    globalStore.send.setTicket("");
    globalStore.send.setTicketQrCode("");
    globalStore.send.setIsSending(false);
  }

  function handleTextInput(value: string) {
    requestVersion += 1;
    globalStore.send.setTextContent(value);
    globalStore.send.setTicket("");
    globalStore.send.setTicketQrCode("");
    globalStore.send.setIsSending(false);
  }

  createEffect(() => {
    return () => {
      requestVersion += 1;
      globalStore.send.setIsSending(false);
    };
  });

  return (
    <div class="space-y-4">
      <Show
        when={isTextMode()}
        fallback={
          <div class="grid min-w-0 grid-cols-1 gap-3">
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

      <Show when={!isTextMode() && sendPath()}>
        <div class="border-base-300/50 bg-base-200/40 flex min-w-0 items-center gap-3 rounded-xl border px-4 py-3">
          <div class="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
            <FileText size={18} />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">
              {getDisplayName(sendPath())}
            </p>
            <p class="text-xs opacity-50">
              {sendFileSize() > 0
                ? `${(sendFileSize() / 1024 / 1024).toFixed(2)} MB`
                : ""}
            </p>
          </div>
          <button
            onClick={handleRemoveFile}
            class="btn btn-ghost btn-xs btn-circle shrink-0"
            aria-label={t("common.remove")}
          >
            ✕
          </button>
        </div>
      </Show>

      <Show
        when={
          !sendTicket() &&
          ((isTextMode() && textContent()?.trim()) ||
            (!isTextMode() && sendPath()))
        }
      >
        <div class="border-base-300/70 bg-base-100/60 flex min-w-0 items-center gap-3 rounded-2xl border px-4 py-3">
          <div class="bg-base-200 text-base-content/60 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
            <Link2 size={18} />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">
              {t("send.shareViaTicket")}
            </p>
            <p class="mt-0.5 text-xs leading-5 opacity-55">
              {t("send.shareViaTicketHint")}
            </p>
          </div>
          <button
            onClick={() => void generateTicket()}
            class="btn btn-outline btn-sm shrink-0 rounded-xl"
            disabled={isSending()}
          >
            <Show
              when={!isSending()}
              fallback={<Loader2 size={14} class="animate-spin" />}
            >
              {t("send.generateTicket")}
            </Show>
          </button>
        </div>
      </Show>

      <Show when={sendTicket()}>
        <Motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: 0.4,
            type: "spring",
            stiffness: 400,
            damping: 30,
          }}
          class="surface-card space-y-4 p-5"
        >
          <div class="flex items-center gap-2">
            <Motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 500,
                damping: 25,
                delay: 0.1,
              }}
            >
              <Sparkles size={16} class="text-success" />
            </Motion.div>
            <div>
              <p class="text-sm font-semibold">{t("send.ticketReady")}</p>
              <p class="text-base-content/60 mt-1 text-xs leading-5">
                {t("send.readyHint")}
              </p>
            </div>
          </div>

          <ShareTicketCard
            ticket={sendTicket()}
            qrCode={sendTicketQrCode()}
            isMobile={props.isMobile}
            showQrCode={props.showQrCode}
            setShowQrCode={props.setShowQrCode}
            title={t("send.ticketReady")}
            subtitle={t("send.readyHint")}
            onCopy={props.onCopy}
            onShare={props.onShare}
          />
        </Motion.div>
      </Show>
    </div>
  );
};

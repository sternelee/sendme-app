import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import { Download, Copy, Shield, Scan, RefreshCw } from "lucide-solid";

import { i18n } from "@sendme/shared";
import { useGlobalStore } from "~/lib/store";
import { receive_file, cancel_transfer, pick_directory } from "~/bindings";
import { toast } from "solid-sonner";

import {
  scan,
  Format,
  checkPermissions,
  requestPermissions,
} from "@tauri-apps/plugin-barcode-scanner";
import { listen } from "@tauri-apps/api/event";
import { TransferProgress } from "~/lib/components/TransferProgress";
import {
  buildReceiveProgressCards,
  type PendingReceiveCard,
  type ReceiveProgressSnapshot,
} from "~/lib/transfer-ui";
import type { ProgressUpdate } from "~/lib/types";

const t = i18n.t;

interface ReceivePanelProps {
  isMobile: boolean;
  pendingReceiveCards: PendingReceiveCard[];
  onReload?: () => void;
}

export const ReceivePanel: Component<ReceivePanelProps> = (props) => {
  const globalStore = useGlobalStore();
  const [progressData, setProgressData] = createSignal<
    Record<string, ReceiveProgressSnapshot>
  >({});

  const receiveTicket = () => globalStore.receive.state().ticket;
  const receiveOutputDir = () => globalStore.receive.state().outputDir;
  const isReceiving = () => globalStore.receive.state().isReceiving;

  const receiveCards = createMemo(() =>
    buildReceiveProgressCards(progressData(), {
      now: Date.now(),
      retainCompletedMs: 2_000,
      limit: 3,
      pending: props.pendingReceiveCards,
    }),
  );

  const nearbyReceiveCard = createMemo(() => {
    if (globalStore.nearbyReceive.state().transferState !== "receiving") {
      return null;
    }

    const request = globalStore.nearbyReceive.state().incomingRequest;
    if (!request) {
      return null;
    }

    const progress = globalStore.nearbyReceive.state().transferProgress;
    return {
      title: request.senderName,
      transferred: progress?.transferred ?? 0,
      total: progress?.total ?? request.totalSize ?? 1,
      speed: progress?.speed ?? 0,
      eta: progress?.eta ?? 0,
      isPending: !progress,
    };
  });

  async function selectOutputDirectory() {
    try {
      if (props.isMobile) {
        const result = await pick_directory();
        globalStore.receive.setOutputDir(result.uri);
      } else {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ multiple: false, directory: true });
        if (selected && typeof selected === "string") {
          globalStore.receive.setOutputDir(selected);
        }
      }
    } catch {
      toast.error(t("receive.folderPickerError"));
    }
  }

  async function handleReceive() {
    const ticket = receiveTicket().trim();
    if (!ticket) return;

    globalStore.receive.setIsReceiving(true);
    try {
      await receive_file({
        ticket,
        output_dir: receiveOutputDir() || undefined,
      });
      props.onReload?.();
      globalStore.receive.setTicket("");
      toast.success(t("receive.connecting"));
    } catch (e) {
      toast.error(`${t("receive.receiveError")}: ${e}`);
    } finally {
      globalStore.receive.setIsReceiving(false);
    }
  }

  async function handleScanBarcode() {
    try {
      let permissionStatus = await checkPermissions();
      if (permissionStatus !== "granted") {
        permissionStatus = await requestPermissions();
      }
      if (permissionStatus === "granted") {
        const result = await scan({ formats: [Format.QRCode] });
        if (result?.content) {
          globalStore.receive.setTicket(result.content);
        }
      } else {
        toast.error(t("receive.scanError"));
      }
    } catch {
      toast.error(t("receive.scanError"));
    }
  }

  async function pasteTicketFromClipboard() {
    try {
      let text: string;
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      try {
        text = await readText();
      } catch (tauriErr) {
        console.warn("Tauri clipboard read failed, falling back:", tauriErr);
        text = await navigator.clipboard.readText();
      }
      text = text.trim();
      if (!text) {
        toast.error(t("receive.clipboardError"));
        return;
      }
      globalStore.receive.setTicket(text);
      toast.success(t("receive.readyToDownload"));
    } catch (error) {
      console.error("Clipboard read failed:", error);
      toast.error(t("receive.clipboardError"));
    }
  }

  createEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<ProgressUpdate>("progress", (event) => {
      const { transfer_id, ...data } = event.payload.data;
      const now = Date.now();

      setProgressData((prev) => {
        const prevData = prev[transfer_id];
        let speed = prevData?.progress?.speed ?? 0;

        if (
          data.progress?.type === "downloading" &&
          typeof data.progress.total === "number" &&
          data.progress.total > 0
        ) {
          const alpha = 0.3;
          const offset = data.progress.offset as number;
          const lastOffset = prevData?.progress?.offset ?? offset;
          const lastTime = prevData?.lastTime ?? now;
          const dt = Math.max(now - lastTime, 1);
          const rawSpeed = ((offset - lastOffset) / dt) * 1000;
          speed = Math.max(0, speed * (1 - alpha) + rawSpeed * alpha);
        }

        return {
          ...prev,
          [transfer_id]: {
            ...prevData,
            transfer_id,
            name:
              typeof data.name === "string" && data.name.trim()
                ? data.name
                : prevData?.name,
            lastTime: now,
            completedAt:
              data.progress?.type === "completed" ? now : prevData?.completedAt,
            progress: {
              ...(prevData?.progress ?? {}),
              ...(data.progress ?? {}),
              speed: Math.round(speed),
            },
          },
        };
      });

      if (data.progress?.type === "completed") {
        window.setTimeout(() => {
          setProgressData((prev) => {
            if (!prev[transfer_id]) return prev;
            const next = { ...prev };
            delete next[transfer_id];
            return next;
          });
        }, 2_000);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  });

  async function handleCancelById(id: string) {
    try {
      await cancel_transfer(id);
      setProgressData((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      props.onReload?.();
    } catch {
      toast.error(t("receive.cancelError"));
    }
  }

  return (
    <div class="space-y-4">
      <div class="border-base-300/70 bg-base-100/70 rounded-3xl border p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <label class="text-sm font-medium">{t("common.pasteTicket")}</label>
            <p class="text-base-content/60 mt-1 text-xs leading-5">
              {t("receive.stackHint")}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              onClick={pasteTicketFromClipboard}
              class="btn btn-ghost btn-xs rounded-xl"
              title={t("receive.pasteFromClipboard")}
            >
              <Copy size={14} />
              {t("common.paste")}
            </button>
            <Show when={props.isMobile}>
              <button
                onClick={handleScanBarcode}
                class="btn btn-ghost btn-xs rounded-xl"
                title={t("receive.scanQr")}
              >
                <Scan size={14} />
                {t("receive.scanQr")}
              </button>
            </Show>
          </div>
        </div>

        <div class="border-base-300/70 bg-base-100 rounded-xl border px-4 py-3">
          <div class="text-base-content/40 mb-2 flex items-center gap-2">
            <Shield size={16} />
            <span class="text-xs font-medium tracking-[0.16em] uppercase">
              {t("receive.incomingTickets")}
            </span>
          </div>
          <textarea
            value={receiveTicket()}
            onInput={(e) =>
              globalStore.receive.setTicket(e.currentTarget.value)
            }
            placeholder={t("common.pasteTicket")}
            rows={props.isMobile ? 4 : 3}
            class="textarea textarea-ghost min-h-28 w-full resize-none p-0 leading-6"
          />
        </div>
      </div>

      <div class="border-base-300/70 bg-base-100/70 rounded-3xl border p-4">
        <div class="mb-2 flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{t("common.defaultDownloads")}</p>
            <p class="text-base-content/60 mt-1 truncate text-xs">
              {receiveOutputDir()
                ? receiveOutputDir().split(/[\\/]/).pop() || receiveOutputDir()
                : t("common.defaultDownloads")}
            </p>
          </div>
          <button
            onClick={selectOutputDirectory}
            class="btn btn-outline btn-sm shrink-0 rounded-xl"
          >
            <RefreshCw size={14} />
            {t("send.chooseFolder")}
          </button>
        </div>
        <div class="border-base-300/70 bg-base-100 text-base-content/75 max-w-full min-w-0 overflow-hidden rounded-xl border px-4 py-3 text-sm break-all">
          {receiveOutputDir() || t("common.defaultDownloads")}
        </div>
      </div>

      <button
        onClick={handleReceive}
        disabled={isReceiving() || !receiveTicket().trim()}
        class="btn btn-secondary btn-lg w-full rounded-xl shadow-sm"
      >
        <Download size={18} /> {t("receive.receiveFile")}
      </button>

      <Show when={receiveCards().length > 0}>
        <div class="space-y-3">
          <For each={receiveCards()}>
            {(card) => (
              <TransferProgress
                title={card.title}
                transferred={card.transferred}
                total={card.total}
                speed={card.speed}
                eta={card.eta}
                isReceiving={true}
                isPending={card.isPending}
                isCompleted={card.isCompleted}
                onCancel={
                  card.isCompleted || card.isPending
                    ? undefined
                    : () => handleCancelById(card.id)
                }
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={nearbyReceiveCard()}>
        {(card) => (
          <TransferProgress
            title={card().title}
            transferred={card().transferred}
            total={card().total}
            speed={card().speed}
            eta={card().eta}
            isReceiving={true}
            isPending={card().isPending}
            onCancel={
              card().isPending
                ? undefined
                : async () => {
                    globalStore.nearbyReceive.setIncomingRequest(null);
                    globalStore.nearbyReceive.setTransferState("idle");
                  }
            }
          />
        )}
      </Show>
    </div>
  );
};

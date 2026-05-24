import { Component, Show, createSignal, createEffect } from "solid-js";
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
import type { ProgressData, ProgressUpdate } from "~/lib/types";

const t = i18n.t;

interface ReceivePanelProps {
  isMobile: boolean;
  onReload?: () => void;
}


export const ReceivePanel: Component<ReceivePanelProps> = (props) => {
  const globalStore = useGlobalStore();

  const [currentReceivingId, setCurrentReceivingId] = createSignal<
    string | null
  >(null);
  const [progressData, setProgressData] = createSignal<
    Record<string, ProgressData>
  >({});

  const receiveTicket = () => globalStore.receive.state().ticket;
  const receiveOutputDir = () => globalStore.receive.state().outputDir;
  const isReceiving = () => globalStore.receive.state().isReceiving;

  async function selectOutputDirectory() {
    try {
      if (props.isMobile) {
        const result = await pick_directory();
        globalStore.receive.setOutputDir(result.uri);
      } else {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ multiple: false, directory: true });
        if (selected && typeof selected === "string")
          globalStore.receive.setOutputDir(selected);
      }
    } catch (e) {}
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
      toast.error(`${t("common.confirm")}: ${e}`);
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
        toast.error(t("receive.clipboardError"));
      }
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function pasteTicketFromClipboard() {
    try {
      let text: string;
      const { readText } = await import(
        "@tauri-apps/plugin-clipboard-manager"
      );
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
      setProgressData((prev) => {
        const prevData = prev[transfer_id];
        let downloadPercent = prevData?.downloadPercent ?? 0;
        let speed = prevData?.progress?.speed ?? 0;
        const now = Date.now();
        if (
          data.progress?.type === "downloading" &&
          data.progress.total > 0
        ) {
          downloadPercent = Math.max(
            downloadPercent,
            (data.progress.offset / data.progress.total) * 100,
          );
          const alpha = 0.3;
          const offset = data.progress.offset as number;
          const lastOffset = prevData?.lastOffset ?? offset;
          const lastTime = prevData?.lastTime ?? now;
          const dt = Math.max(now - lastTime, 1);
          const rawSpeed = ((offset - lastOffset) / dt) * 1000;
          speed = Math.max(0, speed * (1 - alpha) + rawSpeed * alpha);
        }
        return {
          ...prev,
          [transfer_id]: {
            transfer_id,
            event_type: event.payload.event_type,
            downloadPercent,
            lastOffset:
              data.progress?.type === "downloading"
                ? data.progress.offset
                : prevData?.lastOffset,
            lastTime:
              data.progress?.type === "downloading"
                ? now
                : prevData?.lastTime,
            ...data,
            progress: {
              ...(data.progress ?? {}),
              speed: Math.round(speed),
            },
          },
        };
      });
      if (
        !currentReceivingId() &&
        data.progress?.type &&
        data.progress.type !== "completed"
      )
        setCurrentReceivingId(transfer_id);
      if (
        currentReceivingId() === transfer_id &&
        data.progress?.type === "completed"
      ) {
        setTimeout(() => {
          if (currentReceivingId() === transfer_id)
            setCurrentReceivingId(null);
        }, 2000);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  });

  async function handleCancelById(id: string) {
    try {
      await cancel_transfer(id);
      props.onReload?.();
    } catch (e) {}
  }

  return (
    <div class="space-y-4">
      <div class="border-base-300/70 bg-base-100/70 rounded-3xl border p-4">
        <div class="mb-2 flex items-center justify-between gap-3">
          <label class="text-sm font-medium">
            {t("common.pasteTicket")}
          </label>
          <button
            onClick={pasteTicketFromClipboard}
            class="btn btn-ghost btn-xs"
            title={t("receive.pasteFromClipboard")}
          >
            <Copy size={14} />
            {t("common.paste")}
          </button>
        </div>
        <label class="input input-bordered bg-base-100 flex w-full items-center gap-2 rounded-2xl">
          <Shield size={18} class="opacity-40" />
          <input
            type="text"
            value={receiveTicket()}
            onInput={(e) =>
              globalStore.receive.setTicket(e.currentTarget.value)
            }
            placeholder={t("common.pasteTicket")}
            class="grow"
          />
          <Show when={props.isMobile}>
            <button
              onClick={handleScanBarcode}
              class="btn btn-ghost btn-sm btn-circle"
              title="Scan QR"
            >
              <Scan size={18} />
            </button>
          </Show>
        </label>
      </div>

      <div class="border-base-300/70 bg-base-100/70 rounded-3xl border p-4">
        <div class="mb-2 flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">
              {t("common.defaultDownloads")}
            </p>
            <p class="text-base-content/60 mt-1 truncate text-xs">
              {receiveOutputDir()
                ? receiveOutputDir().split(/[\\/]/).pop() ||
                  receiveOutputDir()
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
        <div class="border-base-300/70 bg-base-100 text-base-content/75 max-w-full min-w-0 overflow-hidden rounded-2xl border px-4 py-3 text-sm break-all">
          {receiveOutputDir() || t("common.defaultDownloads")}
        </div>
      </div>

      <button
        onClick={handleReceive}
        disabled={isReceiving() || !receiveTicket().trim()}
        class="btn btn-secondary btn-lg w-full rounded-2xl shadow-sm"
      >
        <Download size={18} /> {t("receive.receiveFile")}
      </button>

      <Show when={currentReceivingId()}>
        {(id) => {
          const data = progressData()[id()];
          const offset = data?.progress?.offset ?? 0;
          const total = data?.progress?.total ?? 1;
          const speed = data?.progress?.speed ?? 0;
          const eta = speed > 0 ? Math.ceil((total - offset) / speed) : 0;
          return (
            <TransferProgress
              transferred={offset}
              total={total}
              speed={speed}
              eta={eta}
              isReceiving={true}
              onCancel={() => handleCancelById(id())}
            />
          );
        }}
      </Show>

      <Show
        when={
          globalStore.nearbyReceive.state().transferState === "receiving" &&
          globalStore.nearbyReceive.state().transferProgress
        }
      >
        <TransferProgress
          transferred={
            globalStore.nearbyReceive.state().transferProgress!
              .transferred
          }
          total={
            globalStore.nearbyReceive.state().transferProgress!.total
          }
          speed={
            globalStore.nearbyReceive.state().transferProgress!.speed
          }
          eta={
            globalStore.nearbyReceive.state().transferProgress!.eta
          }
          isReceiving={true}
          onCancel={async () => {
            globalStore.nearbyReceive.setIncomingRequest(null);
            globalStore.nearbyReceive.setTransferState("idle");
          }}
        />
      </Show>
    </div>
  );
};

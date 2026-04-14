import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import {
  get_nearby_devices,
  get_nearby_profile,
  send_to_device,
  start_nearby_discovery,
  type NearbyDevice,
  type NearbyProfile,
  type NearbySendItem,
  type NearbyTransferState,
} from "~/bindings";
import { useGlobalStore } from "~/lib/store";
import { DropZone } from "~/lib/components/DropZone";
import { NearbyDeviceList } from "~/lib/components/NearbyDeviceList";
import { FileManifest } from "~/lib/components/FileManifest";
import { TransferProgress } from "~/lib/components/TransferProgress";
import { ConnectionWaiting } from "~/lib/components/ConnectionWaiting";
import { toast } from "solid-sonner";
import { i18n } from "~/lib/i18n";

const t = i18n.t;
const RECONCILE_INTERVAL_MS = 20_000;

export default function NearbyPage() {
  const store = useGlobalStore();
  const [isScanning, setIsScanning] = createSignal(false);
  const [nearbyProfile, setNearbyProfile] = createSignal<NearbyProfile | null>(
    null,
  );
  let refreshInFlight = false;

  const nearbyState = () => store.nearbySend.state();

  async function refreshDevices(options?: {
    showSpinner?: boolean;
    restartDiscovery?: boolean;
  }) {
    if (refreshInFlight) return;

    refreshInFlight = true;
    if (options?.showSpinner) {
      setIsScanning(true);
      store.nearbySend.setDiscoveryState("scanning");
    }

    try {
      if (options?.restartDiscovery) {
        await start_nearby_discovery();
      }

      const [profile, devices] = await Promise.all([
        get_nearby_profile(),
        get_nearby_devices(),
      ]);
      setNearbyProfile(profile);
      store.nearbySend.setNearbyDevices(devices);
      store.nearbySend.setDiscoveryState("idle");
      store.nearbySend.setError(null);
    } catch (error) {
      const message = `Failed to scan nearby devices: ${error}`;
      store.nearbySend.setDiscoveryState("error");
      store.nearbySend.setError(message);
    } finally {
      refreshInFlight = false;
      if (options?.showSpinner) {
        setIsScanning(false);
      }
    }
  }

  onMount(async () => {
    await refreshDevices({ showSpinner: true, restartDiscovery: true });

    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshDevices();
    }, RECONCILE_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void refreshDevices();
    };

    const unlistenSendState = await listen<NearbyTransferState>(
      "nearby_send_state",
      (event) => {
        const payload = event.payload;
        if (payload.deviceName && nearbyState().selectedDevice) {
          store.nearbySend.setSelectedDevice({
            ...nearbyState().selectedDevice!,
            name: payload.deviceName,
            deviceType:
              (payload.deviceType as NearbyDevice["deviceType"]) ??
              nearbyState().selectedDevice!.deviceType,
          });
        }

        if (payload.progress) {
          store.nearbySend.setTransferProgress(payload.progress);
        }

        switch (payload.state) {
          case "waiting":
          case "accepted":
            store.nearbySend.setTransferState("waiting");
            break;
          case "transferring":
            store.nearbySend.setTransferState("transferring");
            break;
          case "done":
            store.nearbySend.setTransferState("done");
            break;
          case "declined":
          case "cancelled":
          case "error":
            store.nearbySend.setTransferState("error");
            store.nearbySend.setError(
              payload.message ?? t("nearby.transferFailed"),
            );
            break;
        }
      },
    );

    const unlistenDevices = await listen<NearbyDevice[]>(
      "nearby_devices_updated",
      (event) => {
        store.nearbySend.setNearbyDevices(event.payload);
        store.nearbySend.setDiscoveryState("idle");
        store.nearbySend.setError(null);
        setIsScanning(false);
      },
    );

    document.addEventListener("visibilitychange", handleVisibilityChange);

    onCleanup(() => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unlistenSendState();
      unlistenDevices();
    });
  });

  const totalSize = () =>
    nearbyState().files.reduce((sum, file) => sum + file.size, 0);

  async function handleDeviceSelect(device: NearbyDevice) {
    if (nearbyState().files.length === 0) {
      toast.error(t("nearby.selectFilesFirst"));
      return;
    }

    store.nearbySend.setSelectedDevice(device);
    store.nearbySend.setTransferState("waiting");
    store.nearbySend.setTransferProgress({
      transferred: 0,
      total: totalSize(),
      speed: 0,
      eta: 0,
    });
    store.nearbySend.setError(null);

    try {
      const fileItems: NearbySendItem[] = nearbyState().files.map((file) => ({
        path: file.path,
        filename: file.name,
      }));
      await send_to_device(fileItems, device.id);
    } catch (error) {
      store.nearbySend.setTransferState("error");
      store.nearbySend.setError(String(error));
    }
  }

  function handleCancel() {
    const files = nearbyState().files;
    store.nearbySend.reset();
    store.nearbySend.setFiles(files);
  }

  function handleDone() {
    store.nearbySend.reset();
  }

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-base-content/60 text-sm font-bold tracking-wider uppercase">
          {t("nearby.title")}
        </h2>
        <Show when={nearbyProfile()}>
          <div class="text-base-content/60 text-right text-xs">
            <span class="font-medium">{nearbyProfile()!.name}</span>
          </div>
        </Show>
      </div>

      <DropZone
        files={nearbyState().files}
        onFilesSelected={(files) =>
          store.nearbySend.setFiles(files.map((file) => ({ ...file })))
        }
        onRemoveFile={(index) =>
          store.nearbySend.setFiles(
            nearbyState().files.filter((_, current) => current !== index),
          )
        }
      />

      <NearbyDeviceList
        devices={nearbyState().nearbyDevices}
        isScanning={isScanning()}
        selectedDeviceId={nearbyState().selectedDevice?.id ?? null}
        onDeviceSelect={handleDeviceSelect}
        onRefresh={() =>
          void refreshDevices({ showSpinner: true, restartDiscovery: true })
        }
        error={nearbyState().error}
      />

      <Show
        when={
          nearbyState().files.length > 0 &&
          nearbyState().transferState === "idle"
        }
      >
        <FileManifest files={nearbyState().files} totalSize={totalSize()} />
      </Show>

      <Show
        when={
          nearbyState().transferState === "waiting" &&
          nearbyState().selectedDevice
        }
      >
        <ConnectionWaiting
          deviceName={nearbyState().selectedDevice!.name}
          onCancel={handleCancel}
        />
      </Show>

      <Show
        when={
          nearbyState().transferState === "transferring" &&
          nearbyState().transferProgress
        }
      >
        <TransferProgress
          transferred={nearbyState().transferProgress!.transferred}
          total={nearbyState().transferProgress!.total}
          speed={nearbyState().transferProgress!.speed}
          eta={nearbyState().transferProgress!.eta}
          onCancel={handleCancel}
        />
      </Show>

      <Show when={nearbyState().transferState === "done"}>
        <div class="border-success/20 bg-success/10 rounded-lg border p-4 text-center">
          <p class="text-success font-medium">{t("nearby.transferComplete")}</p>
          <button onClick={handleDone} class="btn btn-success btn-sm mt-2">
            {t("common.done")}
          </button>
        </div>
      </Show>

      <Show when={nearbyState().transferState === "error"}>
        <div class="border-error/20 bg-error/10 rounded-lg border p-4 text-center">
          <p class="text-error font-medium">{nearbyState().error}</p>
          <button onClick={handleCancel} class="btn btn-error btn-sm mt-2">
            {t("common.tryAgain")}
          </button>
        </div>
      </Show>
    </div>
  );
}

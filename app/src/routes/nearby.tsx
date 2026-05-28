import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import {
  get_nearby_devices,
  get_nearby_profile,
  send_to_device,
  start_nearby_discovery,
  type NearbyDevice as NearbyBindingDevice,
  type NearbyProfile,
  type NearbySendItem,
  type NearbyTransferState,
} from "~/bindings";
import { useGlobalStore } from "~/lib/store";
import { NearbyDeviceList } from "~/lib/components/NearbyDeviceList";
import { TransferProgress } from "~/lib/components/TransferProgress";
import { ConnectionWaiting } from "~/lib/components/ConnectionWaiting";

import { i18n } from "@sendme/shared";

const t = i18n.t;
const RECONCILE_INTERVAL_MS = 20_000;

interface NearbyPageProps {
  sendPath?: string;
  isFolder?: boolean;
}

export default function NearbyPage(props: NearbyPageProps) {
  const store = useGlobalStore();
  const [isScanning, setIsScanning] = createSignal(false);
  const [nearbyProfile, setNearbyProfile] = createSignal<NearbyProfile | null>(
    null,
  );
  let refreshInFlight = false;

  const nearbyState = () => store.nearbySend.state();
  const hasActiveTransfer = createMemo(() =>
    ["waiting", "transferring", "done", "error"].includes(
      nearbyState().transferState,
    ),
  );

  async function ensureNearbyNotificationPermission() {
    const currentPlatform = platform();
    const isMobile = currentPlatform === "android" || currentPlatform === "ios";
    if (!isMobile) return;

    try {
      if (await isPermissionGranted()) return;
      await requestPermission();
    } catch {
      // Best-effort only; nearby should continue working without blocking on this.
    }
  }

  async function refreshDevices(options?: {
    showSpinner?: boolean;
    restartDiscovery?: boolean;
  }) {
    if (refreshInFlight) return;
    if (hasActiveTransfer() && !options?.restartDiscovery) return;

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
    void ensureNearbyNotificationPermission();
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
              (payload.deviceType as NearbyBindingDevice["deviceType"]) ??
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

    const unlistenDevices = await listen<NearbyBindingDevice[]>(
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

  async function handleDeviceSelect(device: {
    id: string;
    name: string;
    deviceType: "phone" | "tablet" | "laptop" | "desktop" | "unknown";
  }) {
    if (!props.sendPath) {
      return;
    }

    const selectedDevice = nearbyState().nearbyDevices.find(
      (item) => item.id === device.id,
    ) ?? {
      ...device,
      addresses: [],
    };
    store.nearbySend.setSelectedDevice(selectedDevice);
    store.nearbySend.setTransferState("waiting");
    store.nearbySend.setTransferProgress({
      transferred: 0,
      total: 0,
      speed: 0,
      eta: 0,
    });
    store.nearbySend.setError(null);

    try {
      const filename = props.sendPath.split("/").pop() || "file";
      const fileItems: NearbySendItem[] = [{ path: props.sendPath, filename }];
      await send_to_device(fileItems, device.id);
    } catch (error) {
      store.nearbySend.setTransferState("error");
      store.nearbySend.setError(String(error));
    }
  }

  function handleCancel() {
    store.nearbySend.reset();
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

      <Show when={!hasActiveTransfer()}>
        <Show when={!props.sendPath}>
          <div class="border-base-300/50 bg-base-200/40 rounded-xl border px-4 py-3 text-center text-sm opacity-70">
            {t("send.selectSomethingFirst")}
          </div>
        </Show>
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
        <div                     class="alert alert-success text-center">
          <p class="text-success font-medium">{t("nearby.transferComplete")}</p>
          <button onClick={handleDone} class="btn btn-success btn-sm mt-2">
            {t("common.done")}
          </button>
        </div>
      </Show>

      <Show when={nearbyState().transferState === "error"}>
        <div                     class="alert alert-error text-center">
          <p class="text-error font-medium">{nearbyState().error}</p>
          <button onClick={handleCancel} class="btn btn-error btn-sm mt-2">
            {t("common.tryAgain")}
          </button>
        </div>
      </Show>
    </div>
  );
}

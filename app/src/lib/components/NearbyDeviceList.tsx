import { Component, Show, For } from "solid-js";
import { Smartphone, Laptop, Monitor, Tablet, RefreshCw } from "lucide-solid";
import { i18n } from "~/lib/i18n";

const t = i18n.t;

interface NearbyDevice {
  id: string;
  name: string;
  deviceType: "phone" | "tablet" | "laptop" | "desktop" | "unknown";
}

interface NearbyDeviceListProps {
  devices: NearbyDevice[];
  isScanning: boolean;
  selectedDeviceId: string | null;
  onDeviceSelect: (device: NearbyDevice) => void;
  onRefresh: () => void;
  error?: string | null;
}

const DeviceIcon: Component<{ type: string }> = (props) => {
  switch (props.type) {
    case "phone":
      return <Smartphone size={24} />;
    case "tablet":
      return <Tablet size={24} />;
    case "laptop":
      return <Laptop size={24} />;
    case "desktop":
      return <Monitor size={24} />;
    default:
      return <Laptop size={24} />;
  }
};

export const NearbyDeviceList: Component<NearbyDeviceListProps> = (props) => {
  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium opacity-60">{t("nearby.devices")}</span>
        <button
          onClick={props.onRefresh}
          class={`btn btn-ghost btn-xs ${props.isScanning ? "loading" : ""}`}
          disabled={props.isScanning}
        >
          <RefreshCw size={14} class={props.isScanning ? "animate-spin" : ""} />
        </button>
      </div>

      <Show when={props.error}>
        <div class="text-error text-sm">{props.error}</div>
      </Show>

      <Show
        when={!props.isScanning || props.devices.length > 0}
        fallback={
          <div class="flex items-center justify-center py-8">
            <span class="loading loading-spinner loading-sm text-primary"></span>
            <span class="ml-2 text-sm opacity-60">{t("nearby.scanning")}</span>
          </div>
        }
      >
        <Show
          when={props.devices.length > 0}
          fallback={
            <div class="py-8 text-center opacity-40">
              <p class="text-sm">{t("nearby.noDevicesFound")}</p>
              <p class="mt-1 text-xs">{t("nearby.noDevicesHint")}</p>
            </div>
          }
        >
          <div class="flex gap-3 overflow-x-auto pb-2">
            <For each={props.devices}>
              {(device) => (
                <button
                  onClick={() => props.onDeviceSelect(device)}
                  class={`flex flex-shrink-0 flex-col items-center rounded-xl border-2 p-4 transition-colors ${
                    props.selectedDeviceId === device.id
                      ? "border-primary bg-primary/10"
                      : "border-base-300 bg-base-200 hover:border-primary/50"
                  }`}
                >
                  <DeviceIcon type={device.deviceType} />
                  <span class="mt-2 text-xs font-medium">{device.name}</span>
                  <span class="text-xs opacity-40">
                    {device.id.slice(0, 8)}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

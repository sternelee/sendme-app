import { Component, Show, For } from "solid-js";
import { Smartphone, Laptop, Monitor, Tablet, RefreshCw } from "lucide-solid";
import { Motion } from "solid-motionone";
import { i18n } from "@sendme/shared";

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
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">{t("nearby.devices")}</p>
          <p class="text-base-content/55 mt-1 text-xs">
            {props.devices.length > 0
              ? t("nearby.devicesFound", { count: props.devices.length })
              : t("nearby.noDevicesHint")}
          </p>
        </div>
        <Motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={props.onRefresh}
          class={`btn btn-ghost btn-sm rounded-xl ${props.isScanning ? "loading" : ""}`}
          disabled={props.isScanning}
        >
          <RefreshCw size={14} class={props.isScanning ? "animate-spin" : ""} />
        </Motion.button>
      </div>

      <Show when={props.error}>
        <Motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          class="border-error/20 bg-error/10 text-error rounded-2xl border px-4 py-3 text-sm"
        >
          {props.error}
        </Motion.div>
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
            <div class="border-base-300/80 rounded-2xl border border-dashed py-8 text-center opacity-50">
              <p class="text-sm">{t("nearby.noDevicesFound")}</p>
              <p class="mt-1 text-xs">{t("nearby.noDevicesHint")}</p>
            </div>
          }
        >
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <For each={props.devices}>
              {(device, index) => (
                <Motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index() * 0.05 }}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => props.onDeviceSelect(device)}
                  class={`flex items-center gap-4 rounded-3xl border p-4 text-left transition-shadow ${
                    props.selectedDeviceId === device.id
                      ? "border-primary bg-primary/10 shadow-md shadow-primary/10"
                      : "border-base-300/70 bg-base-100/80 hover:border-primary/40 hover:bg-primary/5 hover:shadow-lg"
                  }`}
                >
                  <div
                    class={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${
                      props.selectedDeviceId === device.id
                        ? "bg-primary/15 text-primary"
                        : "bg-base-200 text-base-content/70"
                    }`}
                  >
                    <DeviceIcon type={device.deviceType} />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">{device.name}</p>
                    <p class="mt-1 text-xs opacity-45">
                      {device.id.slice(0, 8)}
                    </p>
                  </div>
                  
                  {/* 选中指示器 */}
                  <Show when={props.selectedDeviceId === device.id}>
                    <Motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      class="w-2 h-2 rounded-full bg-primary"
                    />
                  </Show>
                </Motion.button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

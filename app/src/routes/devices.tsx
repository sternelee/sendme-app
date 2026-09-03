import { createSignal, createEffect, onCleanup, Show, For } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import {
  get_cloud_presence_state,
  send_file,
  send_text,
  type CloudDevice,
} from "~/bindings";
import { getTransferListClass } from "~/lib/transfer-ui";
import { useAuth } from "~/lib/auth";
import { getPersistentDeviceId } from "~/lib/cloud-api";
import { useFriends } from "~/lib/friends";
import { i18n } from "@sendme/shared";
import { Smartphone, Laptop, Monitor, RefreshCw, Send } from "lucide-solid";
import { toast } from "solid-sonner";
import AuthPanel from "~/components/AuthPanel";

const t = i18n.t;

function getPlatformIcon(platform: string) {
  switch (platform) {
    case "android":
    case "ios":
      return Smartphone;
    case "macos":
      return Monitor;
    default:
      return Laptop;
  }
}

interface DevicesPageProps {
  sendPath?: string;
  isTextMode?: boolean;
  textContent?: string;
  fileSize?: number;
}

export default function DevicesPage(props: DevicesPageProps) {
  const auth = useAuth();
  const friends = useFriends();
  const isLoggedIn = () => auth.isLoaded() && auth.isSignedIn();
  const [devices, setDevices] = createSignal<CloudDevice[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  const [sendingTo, setSendingTo] = createSignal<string | null>(null);
  const currentDeviceId = getPersistentDeviceId();

  const hasSendContent = () =>
    (props.isTextMode && props.textContent?.trim()) ||
    (!props.isTextMode && props.sendPath);

  const otherDevices = () =>
    devices().filter((d) => d.deviceId !== currentDeviceId);

  async function loadDevices() {
    try {
      const snapshot = await get_cloud_presence_state();
      setDevices(snapshot.devices);
    } catch (error) {
      console.error("Failed to load devices:", error);
    }
  }

  createEffect(() => {
    if (isLoggedIn()) {
      setIsLoading(true);
      loadDevices().finally(() => setIsLoading(false));
    }
  });

  createEffect(() => {
    if (!isLoggedIn()) return;
    let disposed = false;
    const setup = async () => {
      const unlisten = await listen("cloud_devices_updated", () => {
        loadDevices();
      });
      if (disposed) {
        unlisten();
      } else {
        onCleanup(() => unlisten());
      }
    };
    void setup();
  });

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await loadDevices();
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleSendToDevice(deviceId: string, deviceName: string) {
    if (!hasSendContent()) return;
    setSendingTo(deviceId);
    try {
      // Generate ticket on-demand
      const ticketType = "relay_and_addresses";
      const ticket = props.isTextMode
        ? await send_text({
            text: props.textContent?.trim() ?? "",
            ticket_type: ticketType,
          })
        : await send_file({
            path: props.sendPath ?? "",
            ticket_type: ticketType,
          });

      const filename = props.isTextMode
        ? undefined
        : props.sendPath?.split("/").pop() || undefined;

      await friends.sendTicketToDevice(
        deviceId,
        ticket,
        filename,
        props.fileSize,
      );
      toast.success(t("devices.ticketSent", { name: deviceName }));
    } catch (error) {
      console.error("Failed to send to device:", error);
      toast.error(t("devices.sendFailed"));
    } finally {
      setSendingTo(null);
    }
  }

  return (
    <div class="space-y-4">
      <Show
        when={isLoggedIn()}
        fallback={
          <div class="py-4">
            <AuthPanel icon={<Smartphone size={20} />} />
          </div>
        }
      >
        <div class="flex items-center justify-between">
          <p class="text-base-content/55 text-xs">
            {t("devices.countOnline", {
              count: otherDevices().filter((d) => d.online).length,
            })}
          </p>
          <button
            onClick={handleRefresh}
            class="btn btn-ghost btn-sm btn-circle"
            disabled={isRefreshing()}
            title={t("devices.refresh")}
          >
            <RefreshCw size={16} class={isRefreshing() ? "animate-spin" : ""} />
          </button>
        </div>

        <Show when={isLoading()}>
          <div class="flex justify-center py-8">
            <span class="loading loading-spinner loading-md text-primary"></span>
          </div>
        </Show>

        <Show when={!isLoading()}>
          <Show when={otherDevices().length > 0 && !hasSendContent()}>
            <div class="border-base-300/50 bg-base-200/40 rounded-xl border px-4 py-3 text-center text-sm opacity-70">
              {t("send.selectSomethingFirst")}
            </div>
          </Show>
          <Show
            when={otherDevices().length > 0}
            fallback={
              <div class="text-base-content/50 py-12 text-center">
                <Smartphone size={48} class="mx-auto mb-3 opacity-50" />
                <p class="text-sm">{t("devices.noDevices")}</p>
                <p class="text-base-content/40 mt-1 text-xs">
                  {t("devices.subtitle")}
                </p>
              </div>
            }
          >
            <div class={getTransferListClass()}>
              <For each={otherDevices()}>
                {(device) => {
                  const PlatformIcon = getPlatformIcon(device.platform);
                  const isSending = () =>
                    sendingTo() === (device.deviceId ?? device.id);
                  return (
                    <div class="card bg-base-200 shadow-sm transition-shadow hover:shadow-md">
                      <div class="card-body p-4">
                        <div class="flex items-center gap-3">
                          <div class="avatar placeholder">
                            <div class="bg-primary text-primary-content flex h-12 w-12 items-center justify-center rounded-full">
                              <PlatformIcon size={24} />
                            </div>
                          </div>

                          <div class="min-w-0 flex-1">
                            <h4 class="truncate font-semibold">
                              {device.name || "Unknown Device"}
                            </h4>
                            <p class="text-base-content/60 text-xs capitalize">
                              {device.platform}
                            </p>
                          </div>

                          <div class="flex items-center gap-2">
                            <div
                              class={`badge badge-sm ${
                                device.online
                                  ? "badge-success gap-1"
                                  : "badge-ghost gap-1"
                              }`}
                            >
                              <div
                                class={`h-1.5 w-1.5 rounded-full ${
                                  device.online
                                    ? "bg-success-content"
                                    : "bg-base-content/40"
                                }`}
                              />
                              {device.online
                                ? t("devices.online")
                                : t("devices.offline")}
                            </div>

                            <Show when={device.online}>
                              <button
                                onClick={() =>
                                  handleSendToDevice(
                                    device.deviceId ?? device.id,
                                    device.name,
                                  )
                                }
                                class="btn btn-primary btn-sm"
                                disabled={!hasSendContent() || isSending()}
                                title={t("devices.sendTo", {
                                  name: device.name,
                                })}
                              >
                                <Show
                                  when={!isSending()}
                                  fallback={
                                    <span class="loading loading-spinner loading-xs"></span>
                                  }
                                >
                                  <Send size={14} />
                                </Show>
                              </button>
                            </Show>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

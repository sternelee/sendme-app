/**
 * DeviceListModal Component
 * Displays user's devices with online status
 * Allows sending tickets to other devices
 */

import { createSignal, For, Show } from "solid-js";
import { Motion, Presence } from "solid-motionone";
import {
  TbOutlineDeviceDesktop,
  TbOutlineDeviceIpad,
  TbOutlineDeviceMobile,
  TbOutlineDeviceSpeaker,
  TbOutlineX,
  TbOutlineRefresh,
  TbOutlineTrash,
  TbOutlineSend,
  TbOutlineClock,
} from "solid-icons/tb";
import { useAuth } from "clerk-solidjs";
import { useWebSocket, getDeviceId } from "~/lib/composables/useWebSocket";
import type { Device } from "~/lib/composables/useWebSocket";

/**
 * Props
 */
interface DeviceListModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket?: string;
  showSendButton?: boolean;
  onSendToDevice?: (device: Device) => void;
}

function getPlatformIcon(platform: string) {
  switch (platform) {
    case "android":
    case "ios":
      return TbOutlineDeviceMobile;
    case "web":
    case "windows":
    case "mac":
    case "linux":
      return TbOutlineDeviceDesktop;
    case "ipad":
      return TbOutlineDeviceIpad;
    default:
      return TbOutlineDeviceSpeaker;
  }
}

function formatLastSeen(lastSeenAt: Date | string): string {
  const now = Date.now();
  const lastSeen = new Date(lastSeenAt).getTime();
  const diff = now - lastSeen;

  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function DeviceListModal(props: DeviceListModalProps) {
  const { devices: wsDevices, isConnected } = useWebSocket();
  const { getToken } = useAuth();
  const [error, setError] = createSignal<string | null>(null);
  const currentPersistentDeviceId = getDeviceId();

  const devices = wsDevices;
  const isLoading = () => !isConnected();

  const deleteDevice = async (deviceId: string) => {
    try {
      const token = await getToken();
      const response = await fetch(`/api/devices/${deviceId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error("Failed to delete device");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete device");
      console.error("Failed to delete device:", err);
    }
  };

  const sendToDevice = async (device: Device) => {
    if (props.ticket && props.onSendToDevice) {
      props.onSendToDevice(device);
    }
  };

  return (
    <Presence>
      <Show when={props.isOpen}>
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={props.onClose}
        >
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <Motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            class="relative glass rounded-3xl p-6 max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between mb-6">
              <div>
                <h2 class="text-xl font-semibold">Your Devices</h2>
                <p class="text-sm text-white/50 mt-1">
                  {devices().length} device{devices().length !== 1 ? "s" : ""} connected
                </p>
              </div>
              <div class="flex items-center gap-2">
                <Motion.button
                  hover={{ scale: 1.05 }}
                  press={{ scale: 0.95 }}
                  onClick={() => {}}
                  disabled={isLoading()}
                  class="p-2 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                  title="Refresh"
                >
                  <TbOutlineRefresh size={18} class={isLoading() ? "animate-spin" : ""} />
                </Motion.button>
                <Motion.button
                  hover={{ scale: 1.05 }}
                  press={{ scale: 0.95 }}
                  onClick={props.onClose}
                  class="p-2 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <TbOutlineX size={18} />
                </Motion.button>
              </div>
            </div>

            <Show when={error()}>
              <div class="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error()}
              </div>
            </Show>

            <div class="flex-1 overflow-y-auto -mx-2 px-2">
              <Show
                when={devices().length > 0}
                fallback={
                  <div class="text-center py-12 text-white/50">
                    <TbOutlineDeviceDesktop size={48} class="mx-auto mb-3 opacity-50" />
                    <p class="text-sm">No devices found</p>
                  </div>
                }
              >
                <div class="space-y-2">
                  <For each={devices()}>
                    {(device) => {
                      const PlatformIcon = getPlatformIcon(device.platform);
                      const isCurrentDevice = device.deviceId === currentPersistentDeviceId;

                      return (
                        <Motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          class={`group relative p-4 rounded-xl border transition-all ${device.online
                            ? "bg-green-500/5 border-green-500/20 hover:border-green-500/30"
                            : "bg-white/5 border-white/10 hover:border-white/20"
                            }`}
                        >
                          <div class="flex items-start gap-3">
                            <div class={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${device.online
                              ? "bg-green-500/10 text-green-400"
                              : "bg-white/10 text-white/50"
                              }`}>
                              <PlatformIcon size={20} />
                            </div>

                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-2">
                                <h3 class="font-medium text-white truncate">
                                  {device.name}
                                </h3>
                                <Show when={isCurrentDevice}>
                                  <span class="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                    Current
                                  </span>
                                </Show>
                              </div>
                              <div class="flex items-center gap-2 mt-1 text-xs text-white/50">
                                <span class="capitalize">{device.platform}</span>
                                <span>•</span>
                                <div class={`flex items-center gap-1 ${device.online ? "text-green-400" : "text-white/40"
                                  }`}>
                                  <div class={`w-1.5 h-1.5 rounded-full ${device.online ? "bg-green-400" : "bg-white/40"
                                    }`} />
                                  <span>{device.online ? "Online" : "Offline"}</span>
                                </div>
                                <span>•</span>
                                <span class="flex items-center gap-1">
                                  <TbOutlineClock size={12} />
                                  {formatLastSeen(device.lastSeenAt)}
                                </span>
                              </div>
                              <Show when={device.hostname}>
                                <p class="text-xs text-white/30 mt-1 truncate">
                                  {device.hostname}
                                </p>
                              </Show>
                            </div>

                            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Show when={props.showSendButton && props.ticket && device.online && !isCurrentDevice}>
                                <Motion.button
                                  hover={{ scale: 1.05 }}
                                  press={{ scale: 0.95 }}
                                  onClick={() => sendToDevice(device)}
                                  class="p-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
                                  title="Send ticket to this device"
                                >
                                  <TbOutlineSend size={16} />
                                </Motion.button>
                              </Show>
                              <Show when={!isCurrentDevice}>
                                <Motion.button
                                  hover={{ scale: 1.05, backgroundColor: "rgba(239, 68, 68, 0.2)" }}
                                  press={{ scale: 0.95 }}
                                  onClick={() => deleteDevice(device.id)}
                                  class="p-2 rounded-lg bg-white/5 text-white/40 hover:text-red-400 transition-colors"
                                  title="Remove device"
                                >
                                  <TbOutlineTrash size={16} />
                                </Motion.button>
                              </Show>
                            </div>
                          </div>
                        </Motion.div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>

            <Show when={props.ticket}>
              <div class="mt-4 pt-4 border-t border-white/10 text-xs text-white/40 text-center">
                Click the send button to transfer your ticket to another device
              </div>
            </Show>
          </Motion.div>
        </Motion.div>
      </Show>
    </Presence>
  );
}

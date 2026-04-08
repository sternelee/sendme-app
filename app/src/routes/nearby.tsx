import { Component, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useGlobalStore } from "~/lib/store";
import {
  start_nearby_discovery,
  get_nearby_devices,
  stop_nearby_discovery,
  send_to_device,
  type NearbyDevice,
} from "~/bindings";
import { DropZone } from "~/lib/components/DropZone";
import { NearbyDeviceList } from "~/lib/components/NearbyDeviceList";
import { FileManifest } from "~/lib/components/FileManifest";
import { TransferProgress } from "~/lib/components/TransferProgress";
import { ConnectionWaiting } from "~/lib/components/ConnectionWaiting";
import { formatFileSize } from "~/lib/utils";
import { toast } from "solid-sonner";
import { Radio } from "lucide-solid";

interface SelectedFile {
  name: string;
  size: number;
  path: string;
}

interface TransferProgressData {
  transferred: number;
  total: number;
  speed: number;
  eta: number;
}

export default function NearbyPage() {
  const store = useGlobalStore();
  const [selectedFiles, setSelectedFiles] = createSignal<SelectedFile[]>([]);
  const [nearbyDevices, setNearbyDevices] = createSignal<NearbyDevice[]>([]);
  const [isScanning, setIsScanning] = createSignal(false);
  const [selectedDevice, setSelectedDevice] = createSignal<NearbyDevice | null>(null);
  const [transferState, setTransferState] = createSignal<
    "idle" | "waiting" | "transferring" | "done" | "error"
  >("idle");
  const [progress, setProgress] = createSignal<TransferProgressData | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let discoveryInterval: ReturnType<typeof setInterval>;

  onMount(async () => {
    try {
      await start_nearby_discovery();
      setIsScanning(true);
      discoveryInterval = setInterval(async () => {
        try {
          const devices = await get_nearby_devices();
          setNearbyDevices(devices);
        } catch (e) {
          console.error("Failed to get nearby devices:", e);
        }
      }, 2000);
    } catch (e) {
      setError("Failed to start discovery");
      setIsScanning(false);
    }
  });

  onCleanup(async () => {
    if (discoveryInterval) clearInterval(discoveryInterval);
    try {
      await stop_nearby_discovery();
    } catch (e) {}
  });

  const handleFilesSelected = (files: Array<{ name: string; size: number; path: string }>) => {
    setSelectedFiles(files as SelectedFile[]);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDeviceSelect = async (device: NearbyDevice) => {
    if (selectedFiles().length === 0) {
      toast.error("Please select files first");
      return;
    }
    setSelectedDevice(device);
    setTransferState("waiting");
    try {
      await send_to_device(
        selectedFiles().map((f) => f.path),
        device.id
      );
    } catch (e) {
      setError(`Failed to send: ${e}`);
      setTransferState("error");
    }
  };

  const handleRefresh = async () => {
    setIsScanning(true);
    try {
      const devices = await get_nearby_devices();
      setNearbyDevices(devices);
    } catch (e) {
      toast.error(`Refresh failed: ${e}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleCancel = () => {
    setSelectedDevice(null);
    setTransferState("idle");
    setProgress(null);
    setError(null);
  };

  const handleDone = () => {
    setSelectedFiles([]);
    setSelectedDevice(null);
    setTransferState("idle");
    setProgress(null);
    setError(null);
  };

  const totalSize = () => selectedFiles().reduce((sum, f) => sum + f.size, 0);

  return (
    <div class="space-y-4">
      <h2 class="text-sm font-bold text-base-content/60 uppercase tracking-wider">
        Nearby
      </h2>

      {/* Drop Zone */}
      <DropZone
        files={selectedFiles()}
        onFilesSelected={handleFilesSelected}
        onRemoveFile={handleRemoveFile}
      />

      {/* Device List */}
      <NearbyDeviceList
        devices={nearbyDevices()}
        isScanning={isScanning()}
        selectedDeviceId={selectedDevice()?.id}
        onDeviceSelect={handleDeviceSelect}
        onRefresh={handleRefresh}
        error={error()}
      />

      {/* File Manifest (when files selected) */}
      <Show when={selectedFiles().length > 0 && transferState() === "idle"}>
        <FileManifest files={selectedFiles()} totalSize={totalSize()} />
      </Show>

      {/* Waiting State */}
      <Show when={transferState() === "waiting" && selectedDevice()}>
        <ConnectionWaiting
          deviceName={selectedDevice().name}
          onCancel={handleCancel}
        />
      </Show>

      {/* Transfer Progress */}
      <Show when={transferState() === "transferring" && progress()}>
        <TransferProgress
          transferred={progress().transferred}
          total={progress().total}
          speed={progress().speed}
          eta={progress().eta}
          onCancel={handleCancel}
        />
      </Show>

      {/* Done State */}
      <Show when={transferState() === "done"}>
        <div class="bg-success/10 border border-success/20 rounded-lg p-4 text-center">
          <p class="font-medium text-success">Transfer Complete!</p>
          <button onClick={handleDone} class="btn btn-success btn-sm mt-2">
            Done
          </button>
        </div>
      </Show>

      {/* Error State */}
      <Show when={transferState() === "error"}>
        <div class="bg-error/10 border border-error/20 rounded-lg p-4 text-center">
          <p class="font-medium text-error">{error()}</p>
          <button onClick={handleCancel} class="btn btn-error btn-sm mt-2">
            Try Again
          </button>
        </div>
      </Show>
    </div>
  );
}
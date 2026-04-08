import { Component } from "solid-js";
import { X } from "lucide-solid";
import { formatFileSize } from "~/lib/utils";

interface TransferProgressProps {
  transferred: number;
  total: number;
  speed: number;
  eta: number;
  isReceiving?: boolean;
  onCancel: () => void;
}

export const TransferProgress: Component<TransferProgressProps> = (props) => {
  const percent = () => Math.round((props.transferred / props.total) * 100);
  const speedStr = () => formatFileSize(props.speed) + "/s";
  const etaStr = () => {
    if (props.eta < 60) return "~0 min";
    if (props.eta < 3600) return `~${Math.round(props.eta / 60)} min`;
    return `~${Math.round(props.eta / 3600)} hr`;
  };

  return (
    <div class="bg-base-200 rounded-lg p-4 space-y-3">
      <div class="flex justify-between text-sm font-medium">
        <span>{percent()}%</span>
        <span class="opacity-60">{speedStr()}</span>
      </div>
      <progress
        class={`progress w-full ${props.isReceiving ? "progress-secondary" : "progress-primary"}`}
        value={props.transferred}
        max={props.total}
      ></progress>
      <div class="flex justify-between text-xs opacity-60">
        <span>{formatFileSize(props.transferred)} / {formatFileSize(props.total)}</span>
        <span>{etaStr()} remaining</span>
      </div>
      <button onClick={props.onCancel} class="btn btn-ghost btn-sm text-error w-full mt-2">
        <X size={14} class="mr-1" /> Cancel
      </button>
    </div>
  );
};
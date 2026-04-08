import { Component, Show } from "solid-js";
import { Check, X, Loader2 } from "lucide-solid";
import { FileManifest } from "./FileManifest";

interface IncomingRequestCardProps {
  request: {
    id: string;
    senderName: string;
    files: Array<{ name: string; size: number }>;
    totalSize: number;
  };
  onAccept: () => void;
  onDecline: () => void;
  disabled?: boolean;
  state?: "pending" | "accepting" | "declining";
}

export const IncomingRequestCard: Component<IncomingRequestCardProps> = (props) => {
  return (
    <div class="bg-base-200 rounded-lg p-4 space-y-4">
      <div class="flex items-center gap-3">
        <div class="avatar placeholder">
          <div class="bg-secondary/20 text-secondary rounded-full w-12">
            <span class="text-lg">📱</span>
          </div>
        </div>
        <div>
          <p class="font-medium">{props.request.senderName}</p>
          <p class="text-xs opacity-60">wants to send you files</p>
        </div>
      </div>

      <FileManifest
        files={props.request.files}
        totalSize={props.request.totalSize}
        maxHeight="120px"
      />

      <Show when={props.state === "accepting"}>
        <div class="flex items-center justify-center py-2">
          <Loader2 size={20} class="animate-spin text-primary mr-2" />
          <span class="text-sm">Accepting...</span>
        </div>
      </Show>

      <Show when={props.state === "declining"}>
        <div class="flex items-center justify-center py-2">
          <Loader2 size={20} class="animate-spin text-error mr-2" />
          <span class="text-sm">Declining...</span>
        </div>
      </Show>

      <Show when={!props.state || props.state === "pending"}>
        <div class="flex gap-2">
          <button
            onClick={props.onDecline}
            disabled={props.disabled}
            class="btn btn-outline flex-1"
          >
            <X size={16} class="mr-1" /> Decline
          </button>
          <button
            onClick={props.onAccept}
            disabled={props.disabled}
            class="btn btn-secondary flex-1"
          >
            <Check size={16} class="mr-1" /> Accept
          </button>
        </div>
      </Show>
    </div>
  );
};
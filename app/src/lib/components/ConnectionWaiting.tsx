import { Component } from "solid-js";
import { Loader2 } from "lucide-solid";

interface ConnectionWaitingProps {
  deviceName: string;
  onCancel: () => void;
}

export const ConnectionWaiting: Component<ConnectionWaitingProps> = (props) => {
  return (
    <div class="bg-base-200 rounded-lg p-6 text-center space-y-4">
      <div class="flex justify-center">
        <div class="relative">
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="w-16 h-16 rounded-full border-4 border-base-300"></div>
          </div>
          <div class="relative flex items-center justify-center w-16 h-16">
            <Loader2 size={32} class="animate-spin text-primary" />
          </div>
        </div>
      </div>
      <div class="space-y-1">
        <p class="font-medium">Waiting for {props.deviceName} to accept...</p>
        <p class="text-xs opacity-60">They'll see a preview of your files</p>
      </div>
      <button onClick={props.onCancel} class="btn btn-outline btn-sm">
        Cancel
      </button>
    </div>
  );
};
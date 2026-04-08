import { Component, For } from "solid-js";
import { formatFileSize } from "~/lib/utils";

interface FileManifestProps {
  files: Array<{ name: string; size: number }>;
  totalSize: number;
  maxHeight?: string;
}

export const FileManifest: Component<FileManifestProps> = (props) => {
  return (
    <div class="bg-base-200 rounded-lg p-3 space-y-2">
      <div class="flex justify-between text-xs font-medium opacity-60">
        <span>{props.files.length} file{props.files.length !== 1 ? "s" : ""}</span>
        <span>{formatFileSize(props.totalSize)}</span>
      </div>
      <div
        class={`space-y-1 overflow-y-auto ${props.maxHeight || ""}`}
        style={props.maxHeight ? { "max-height": props.maxHeight } : {}}
      >
        <For each={props.files}>
          {(file) => (
            <div class="flex justify-between text-sm">
              <span class="truncate">{file.name}</span>
              <span class="text-xs opacity-60 ml-2">{formatFileSize(file.size)}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
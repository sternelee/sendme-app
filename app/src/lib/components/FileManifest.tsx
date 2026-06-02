import { Component, For } from "solid-js";
import { formatFileSize } from "@sendme/ui";
import { i18n } from "@sendme/shared";

const t = i18n.t;

interface FileManifestProps {
  files: Array<{ name: string; size: number }>;
  totalSize: number;
  maxHeight?: string;
}

export const FileManifest: Component<FileManifestProps> = (props) => {
  return (
    <div class="bg-base-200 space-y-2 rounded-lg p-3">
      <div class="flex justify-between text-xs font-medium opacity-60">
        <span>{t("nearby.fileCount", { count: props.files.length })}</span>
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
              <span class="ml-2 text-xs opacity-60">
                {formatFileSize(file.size)}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

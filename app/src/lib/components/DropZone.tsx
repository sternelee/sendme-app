import { Component, Show, For, createSignal } from "solid-js";
import { Upload, X } from "lucide-solid";
import { formatFileSize } from "@sendme/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { platform } from "@tauri-apps/plugin-os";
import { pick_file, get_file_size } from "~/bindings";
import { i18n } from "@sendme/shared";

const t = i18n.t;

interface DropZoneProps {
  files: Array<{ name: string; size: number; path?: string }>;
  onFilesSelected: (
    files: Array<{ name: string; size: number; path: string }>,
  ) => void;
  onRemoveFile?: (index: number) => void;
}

export const DropZone: Component<DropZoneProps> = (props) => {
  const [isDragover, setIsDragover] = createSignal(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragover(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      const fileInfos = files.map((f) => ({
        name: f.name,
        size: f.size,
        path: (f as unknown as { path?: string }).path || f.name,
      }));
      props.onFilesSelected(fileInfos);
    }
  };

  const handleClick = async () => {
    try {
      const currentPlatform = platform();
      const isMobile = currentPlatform === "android" || currentPlatform === "ios";

      if (isMobile) {
        const selected = await pick_file({ allowMultiple: true });
        if (selected.length > 0) {
          props.onFilesSelected(
            selected.map((file) => ({
              name: file.name,
              size: file.size,
              path: file.path,
            })),
          );
        }
        return;
      }

      const selected = await open({ multiple: true, directory: false });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      const fileInfos = await Promise.all(
        paths.map(async (p) => {
          const filePath = typeof p === "string" ? p : p.path;
          const fileName =
            typeof p === "string" ? p.split(/[\\/]/).pop() || p : p.name;
          let fileSize = 0;
          try {
            fileSize = await get_file_size(filePath);
          } catch {
            // get_file_size failed — keep size 0
          }
          return { name: fileName, size: fileSize, path: filePath };
        }),
      );
      props.onFilesSelected(fileInfos);
    } catch (e) {
      console.error("Failed to open file picker:", e);
    }
  };

  return (
    <div
      class={`cursor-pointer rounded-lg border-2 border-dashed transition-colors overflow-hidden min-w-0 ${
        isDragover()
          ? "border-primary bg-primary/5"
          : "border-base-300 bg-base-300/30 hover:border-primary/50"
      } ${
        props.files.length > 0 ? "p-2" : "p-8 text-center"
      }`}
      onClick={handleClick}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragover(true);
      }}
      onDragLeave={() => setIsDragover(false)}
      onDrop={handleDrop}
    >
      <Show
        when={props.files.length === 0}
        fallback={
          <div class="space-y-1">
            <For each={props.files}>
              {(file, index) => (
                <div class="bg-base-200 flex items-center gap-2 overflow-hidden rounded-lg px-3 py-2">
                  <span class="flex-1 min-w-0 truncate text-sm">{file.name}</span>
                  <span class="text-xs opacity-60 shrink-0 whitespace-nowrap">
                    {formatFileSize(file.size)}
                  </span>
                  <Show when={props.onRemoveFile}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onRemoveFile?.(index());
                      }}
                      class="btn btn-ghost btn-xs shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        }
      >
        <Upload size={32} class="mx-auto mb-2 opacity-40" />
        <p class="text-sm opacity-60">
          {isDragover()
            ? t("nearby.dropFilesHere")
            : t("nearby.dropFilesOrTap")}
        </p>
      </Show>
    </div>
  );
};

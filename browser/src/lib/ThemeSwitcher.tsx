import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { FiChevronDown } from "solid-icons/fi";
import { cn } from "../lib/utils";

interface ThemeSwitcherProps {
  class?: string;
}

const themes = [
  { id: "dark", name: "Dark" },
  { id: "light", name: "Light" },
  { id: "sunset", name: "Sunset" },
  { id: "black", name: "Black" },
  { id: "synthwave", name: "Synthwave" },
  { id: "abyss", name: "Abyss" },
  { id: "luxury", name: "Luxury" },
];

export function ThemeSwitcher(props: ThemeSwitcherProps) {
  const [currentTheme, setCurrentTheme] = createSignal("dark");
  const [isOpen, setIsOpen] = createSignal(false);

  const currentThemeInfo = () =>
    themes.find((t) => t.id === currentTheme()) || themes[0];

  onMount(() => {
    const savedTheme = localStorage.getItem("theme") || "dark";
    setCurrentTheme(savedTheme);
    document.documentElement.setAttribute("data-theme", savedTheme);

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".theme-switcher")) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    onCleanup(() => document.removeEventListener("click", handleClickOutside));
  });

  createEffect(() => {
    const theme = currentTheme();
    localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  });

  const handleThemeChange = (themeId: string) => {
    setCurrentTheme(themeId);
    setIsOpen(false);
  };

  return (
    <div class={`relative theme-switcher ${props.class || ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        aria-haspopup="listbox"
        aria-expanded={isOpen()}
        aria-label={currentThemeInfo().name}
        class="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-base-content/10"
      >
        <div class="bg-base-100 group-hover:border-base-content/20 border-base-content/10 grid shrink-0 grid-cols-2 gap-0.5 rounded-md border p-1 transition-colors">
          <div class="bg-base-content size-1 rounded-full"></div>{" "}
          <div class="bg-primary size-1 rounded-full"></div>{" "}
          <div class="bg-secondary size-1 rounded-full"></div>{" "}
          <div class="bg-accent size-1 rounded-full"></div>
        </div>
        <span class="hidden sm:inline">{currentThemeInfo().name}</span>
        <FiChevronDown
          size={14}
          class={cn(
            "transition-transform duration-200",
            isOpen() && "rotate-180",
          )}
        />
      </button>

      <Show when={isOpen()}>
        <div
          class="absolute right-0 mt-2 w-56 bg-base-100 rounded-xl border border-base-200 shadow-xl overflow-hidden z-50"
          role="listbox"
          aria-label="Choose theme"
        >
          <div class="p-2 max-h-80 overflow-y-auto">
            <div class="text-xs font-semibold text-base-content/60 px-3 py-2 uppercase tracking-wide">
              Choose Theme
            </div>
            <div class="space-y-1">
              <For each={themes}>
                {(theme) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={currentTheme() === theme.id}
                    onClick={() => handleThemeChange(theme.id)}
                    data-theme={theme.id}
                    class={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                      currentTheme() === theme.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    <div class="w-5 h-5 rounded-full flex items-center justify-center">
                      <div class="bg-base-100 group-hover:border-base-content/20 border-base-content/10 grid shrink-0 grid-cols-2 gap-0.5 rounded-md border p-1 transition-colors">
                        <div class="bg-base-content size-1 rounded-full"></div>{" "}
                        <div class="bg-primary size-1 rounded-full"></div>{" "}
                        <div class="bg-secondary size-1 rounded-full"></div>{" "}
                        <div class="bg-accent size-1 rounded-full"></div>
                      </div>
                    </div>
                    <span class="text-sm">{theme.name}</span>
                    <Show when={currentTheme() === theme.id}>
                      <div class="ml-auto">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

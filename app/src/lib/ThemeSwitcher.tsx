import { createSignal, createEffect, onMount, For, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { FiChevronDown } from "solid-icons/fi";

interface ThemeSwitcherProps {
  class?: string;
}

// Theme definitions with icons
const themes = [
  { id: "light", name: "Light" },
  { id: "sunset", name: "Sunset" },
  { id: "black", name: "Black" },
  { id: "synthwave", name: "Synthwave" },
  { id: "abyss", name: "Abyss" },
  { id: "luxury", name: "Luxury" },
];

type Theme = string;

export function ThemeSwitcher(props: ThemeSwitcherProps) {
  const [currentTheme, setCurrentTheme] = createSignal<Theme>("dark");
  const [isOpen, setIsOpen] = createSignal(false);

  const currentThemeInfo = () =>
    themes.find((t) => t.id === currentTheme()) || themes[1];

  onMount(() => {
    const savedTheme = localStorage.getItem("theme") || "dark";
    setCurrentTheme(savedTheme);
    document.documentElement.setAttribute("data-theme", savedTheme);
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

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".theme-switcher")) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  });

  return (
    <div class={`theme-switcher relative ${props.class || ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class="hover:bg-base-content/10 flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
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
        <div class="bg-base-100 border-base-300 animate-in fade-in slide-in-from-top-2 absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border shadow-xl duration-200">
          <div class="max-h-80 overflow-y-auto p-2">
            <div class="text-base-content/60 px-3 py-2 text-xs font-semibold tracking-wide uppercase">
              Choose Theme
            </div>
            <div class="space-y-1">
              <For each={themes}>
                {(theme) => (
                  <button
                    type="button"
                    onClick={() => handleThemeChange(theme.id)}
                    data-theme={theme.id}
                    class={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                      currentTheme() === theme.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    <div class="flex h-5 w-5 items-center justify-center rounded-full">
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

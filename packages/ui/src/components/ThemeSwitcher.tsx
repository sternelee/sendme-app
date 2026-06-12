import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { FiChevronDown } from "solid-icons/fi";
import { cn } from "../utils/cn";

interface ThemeSwitcherProps {
  class?: string;
}

const themes = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
  { id: "sunset", name: "Sunset" },
  { id: "black", name: "Black" },
  { id: "synthwave", name: "Synthwave" },
  { id: "abyss", name: "Abyss" },
  { id: "luxury", name: "Luxury" },
];

type Theme = (typeof themes)[number]["id"];

function resolveTheme(theme: Theme): Exclude<Theme, "system"> {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

export function ThemeSwitcher(props: ThemeSwitcherProps) {
  const [currentTheme, setCurrentTheme] = createSignal<Theme>("system");
  const [isOpen, setIsOpen] = createSignal(false);
  const [menuStyle, setMenuStyle] = createSignal<Record<string, string>>({});
  let buttonRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const currentThemeInfo = () =>
    themes.find((t) => t.id === currentTheme()) || themes[0];

  onMount(() => {
    const savedTheme = localStorage.getItem("theme") || "system";
    const validTheme = themes.some((t) => t.id === savedTheme)
      ? (savedTheme as Theme)
      : "system";
    setCurrentTheme(validTheme);
    document.documentElement.setAttribute("data-theme", resolveTheme(validTheme));
  });

  createEffect(() => {
    const theme = currentTheme();
    localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("data-theme", resolveTheme(theme));
  });

  const handleThemeChange = (themeId: Theme) => {
    setCurrentTheme(themeId);
    setIsOpen(false);
  };

  const updateMenuPosition = () => {
    if (!buttonRef) return;

    const rect = buttonRef.getBoundingClientRect();
    const menuHeight = menuRef?.offsetHeight ?? 344;
    const menuWidth = Math.max(buttonRef.offsetWidth, 240);
    const gap = 8;
    const padding = 12;
    const placeAbove =
      window.innerHeight - rect.bottom < menuHeight + gap + padding &&
      rect.top > menuHeight + gap + padding;
    const top = placeAbove
      ? Math.max(padding, rect.top - menuHeight - gap)
      : Math.min(window.innerHeight - menuHeight - padding, rect.bottom + gap);
    const left = Math.min(
      window.innerWidth - menuWidth - padding,
      Math.max(padding, rect.right - menuWidth),
    );

    setMenuStyle({
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${menuWidth}px`,
      "transform-origin": placeAbove ? "bottom right" : "top right",
    });
  };

  createEffect(() => {
    if (!isOpen()) return;

    const raf = requestAnimationFrame(updateMenuPosition);
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef?.contains(target) || menuRef?.contains(target)) return;
      setIsOpen(false);
    };

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    document.addEventListener("mousedown", handlePointerDown);

    onCleanup(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
    });
  });

  return (
    <div class={props.class || ""}>
      <button
        type="button"
        ref={buttonRef}
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
        <Portal>
          <div
            ref={menuRef}
            style={menuStyle()}
            class="bg-base-100 border-base-300 z-[120] overflow-hidden rounded-xl border shadow-xl"
          >
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
                          : "hover:bg-base-200",
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
        </Portal>
      </Show>
    </div>
  );
}

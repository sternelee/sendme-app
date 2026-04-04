import { createSignal, createEffect, onMount, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineSun,
  TbOutlineMoon,
  TbOutlineDeviceDesktop,
  TbOutlineCheck,
} from "solid-icons/tb";

interface ThemeSwitcherProps {
  class?: string;
}

interface ThemeOption {
  id: string;
  name: string;
  icon: typeof TbOutlineSun;
}

const themes: ThemeOption[] = [
  { id: "light", name: "Light", icon: TbOutlineSun },
  { id: "dark", name: "Dark", icon: TbOutlineMoon },
  { id: "cupcake", name: "Cupcake", icon: TbOutlineSun },
  { id: "synthwave", name: "Synthwave", icon: TbOutlineDeviceDesktop },
  { id: "cyberpunk", name: "Cyberpunk", icon: TbOutlineDeviceDesktop },
  { id: "valentine", name: "Valentine", icon: TbOutlineSun },
  { id: "halloween", name: "Halloween", icon: TbOutlineMoon },
  { id: "forest", name: "Forest", icon: TbOutlineDeviceDesktop },
  { id: "aqua", name: "Aqua", icon: TbOutlineSun },
  { id: "lofi", name: "Lo-Fi", icon: TbOutlineMoon },
  { id: "pastel", name: "Pastel", icon: TbOutlineSun },
  { id: "fantasy", name: "Fantasy", icon: TbOutlineDeviceDesktop },
  { id: "black", name: "Black", icon: TbOutlineMoon },
  { id: "luxury", name: "Luxury", icon: TbOutlineMoon },
  { id: "dracula", name: "Dracula", icon: TbOutlineDeviceDesktop },
  { id: "cmyk", name: "CMYK", icon: TbOutlineSun },
  { id: "autumn", name: "Autumn", icon: TbOutlineMoon },
  { id: "business", name: "Business", icon: TbOutlineDeviceDesktop },
  { id: "night", name: "Night", icon: TbOutlineMoon },
  { id: "coffee", name: "Coffee", icon: TbOutlineDeviceDesktop },
  { id: "winter", name: "Winter", icon: TbOutlineSun },
  { id: "dim", name: "Dim", icon: TbOutlineMoon },
  { id: "nord", name: "Nord", icon: TbOutlineDeviceDesktop },
  { id: "sunset", name: "Sunset", icon: TbOutlineSun },
  { id: "caramellatte", name: "Caramel", icon: TbOutlineSun },
  { id: "abyss", name: "Abyss", icon: TbOutlineMoon },
  { id: "silk", name: "Silk", icon: TbOutlineSun },
];

export function ThemeSwitcher(props: ThemeSwitcherProps) {
  const [currentTheme, setCurrentTheme] = createSignal("dark");
  const [isOpen, setIsOpen] = createSignal(false);

  const currentThemeInfo = () =>
    themes.find((t) => t.id === currentTheme()) || themes[1];
  const CurrentIcon = () => currentThemeInfo().icon;

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
    <div class={`relative theme-switcher ${props.class || ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-base-content/10"
      >
        <Dynamic component={CurrentIcon()} size={18} />
        <span class="text-sm font-medium hidden sm:inline">{currentThemeInfo().name}</span>
      </button>

      <Show when={isOpen()}>
        <div class="absolute right-0 mt-2 w-56 bg-base-100 rounded-xl border border-base-200 shadow-xl overflow-hidden z-50">
          <div class="p-2 max-h-80 overflow-y-auto">
            <div class="text-xs font-semibold text-base-content/60 px-3 py-2 uppercase tracking-wide">
              Choose Theme
            </div>
            <div class="space-y-1">
              <For each={themes}>
                {(theme) => (
                  <button
                    type="button"
                    onClick={() => handleThemeChange(theme.id)}
                    class={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      currentTheme() === theme.id
                        ? "bg-primary text-primary-content"
                        : "hover:bg-base-200"
                    }`}
                  >
                    <Dynamic component={theme.icon} size={16} />
                    <span class="text-sm flex-1 text-left">{theme.name}</span>
                    <Show when={currentTheme() === theme.id}>
                      <TbOutlineCheck size={16} />
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

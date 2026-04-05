import { createSignal, createEffect, onMount, For, Show } from "solid-js";
import { Sun, Moon, Monitor, ChevronDown, Check } from "lucide-solid";

interface ThemeSwitcherProps {
  class?: string;
}

interface ThemeOption {
  id: string;
  name: string;
  icon: typeof Sun;
  preview: string;
}

const themes: ThemeOption[] = [
  { id: "light", name: "Light", icon: Sun, preview: "bg-amber-100" },
  { id: "dark", name: "Dark", icon: Moon, preview: "bg-zinc-900" },
  { id: "cupcake", name: "Cupcake", icon: Sun, preview: "bg-pink-100" },
  {
    id: "synthwave",
    name: "Synthwave",
    icon: Monitor,
    preview: "bg-purple-900",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    icon: Monitor,
    preview: "bg-yellow-500",
  },
  { id: "valentine", name: "Valentine", icon: Sun, preview: "bg-pink-200" },
  { id: "halloween", name: "Halloween", icon: Moon, preview: "bg-orange-900" },
  { id: "forest", name: "Forest", icon: Monitor, preview: "bg-green-900" },
  { id: "aqua", name: "Aqua", icon: Sun, preview: "bg-cyan-200" },
  { id: "lofi", name: "Lo-Fi", icon: Moon, preview: "bg-zinc-300" },
  { id: "pastel", name: "Pastel", icon: Sun, preview: "bg-pink-50" },
  { id: "fantasy", name: "Fantasy", icon: Monitor, preview: "bg-purple-200" },
  { id: "black", name: "Black", icon: Moon, preview: "bg-black" },
  { id: "luxury", name: "Luxury", icon: Moon, preview: "bg-amber-900" },
  { id: "dracula", name: "Dracula", icon: Monitor, preview: "bg-purple-950" },
  { id: "cmyk", name: "CMYK", icon: Sun, preview: "bg-cyan-400" },
  { id: "autumn", name: "Autumn", icon: Moon, preview: "bg-orange-200" },
  { id: "business", name: "Business", icon: Monitor, preview: "bg-blue-900" },
  { id: "night", name: "Night", icon: Moon, preview: "bg-indigo-950" },
  { id: "coffee", name: "Coffee", icon: Monitor, preview: "bg-amber-950" },
  { id: "winter", name: "Winter", icon: Sun, preview: "bg-sky-100" },
  { id: "dim", name: "Dim", icon: Moon, preview: "bg-zinc-800" },
  { id: "nord", name: "Nord", icon: Monitor, preview: "bg-slate-700" },
  { id: "sunset", name: "Sunset", icon: Sun, preview: "bg-orange-400" },
  { id: "caramellatte", name: "Caramel", icon: Sun, preview: "bg-amber-200" },
  { id: "abyss", name: "Abyss", icon: Moon, preview: "bg-slate-950" },
  { id: "silk", name: "Silk", icon: Sun, preview: "bg-blue-200" },
];

type Theme = string;

export function ThemeSwitcher(props: ThemeSwitcherProps) {
  const [currentTheme, setCurrentTheme] = createSignal<Theme>("dark");
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
    <div class={`theme-switcher relative ${props.class || ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class="hover:bg-base-content/10 flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
      >
        {(() => {
          const Icon = currentThemeInfo().icon;
          return <Icon size={18} />;
        })()}
        <span class="hidden text-sm font-medium sm:inline">
          {currentThemeInfo().name}
        </span>
        <ChevronDown
          size={14}
          class={`transition-transform duration-200 ${isOpen() ? "rotate-180" : ""}`}
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
                    class={`flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                      currentTheme() === theme.id
                        ? "bg-primary text-primary-content"
                        : "hover:bg-base-200"
                    }`}
                  >
                    <div
                      class={`h-5 w-5 rounded-full ${theme.preview} flex items-center justify-center`}
                    >
                      <Show when={currentTheme() === theme.id}>
                        <Check size={10} class="text-white" />
                      </Show>
                    </div>
                    <span class="flex-1 text-left text-sm">{theme.name}</span>
                    <Show when={currentTheme() === theme.id}>
                      <Check size={16} />
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

import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { i18n } from "./i18n";
import { TbOutlineCheck } from "solid-icons/tb";
import { FaSolidLanguage } from "solid-icons/fa";

interface LanguageSwitcherProps {
  class?: string;
}

export function LanguageSwitcher(props: LanguageSwitcherProps) {
  const [isOpen, setIsOpen] = createSignal(false);

  const currentLocaleName = () => i18n.localeNames[i18n.locale()];

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".language-switcher")) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    onCleanup(() => document.removeEventListener("click", handleClickOutside));
  });

  const handleLocaleChange = (locale: "en" | "zh-CN") => {
    i18n.setLocale(locale);
    setIsOpen(false);
  };

  return (
    <div class={`relative language-switcher ${props.class || ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        aria-haspopup="listbox"
        aria-expanded={isOpen()}
        aria-label={currentLocaleName()}
        class="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-base-content/10"
      >
        <FaSolidLanguage size={18} />
        <span class="text-sm font-medium hidden sm:inline">
          {currentLocaleName()}
        </span>
      </button>

      <Show when={isOpen()}>
        <div
          class="absolute right-0 mt-2 w-40 bg-base-100 rounded-xl border border-base-200 shadow-xl overflow-hidden z-50"
          role="listbox"
          aria-label="Choose language"
        >
          <div class="p-2">
            <div class="text-xs font-semibold text-base-content/60 px-3 py-2 uppercase tracking-wide">
              Language
            </div>
            <div class="space-y-1">
              {i18n.availableLocales.map((locale) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={i18n.locale() === locale}
                  onClick={() => handleLocaleChange(locale)}
                  class={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                    i18n.locale() === locale
                      ? "bg-primary text-primary-content"
                      : "hover:bg-base-200"
                  }`}
                >
                  <span class="text-sm">{i18n.localeNames[locale]}</span>
                  <Show when={i18n.locale() === locale}>
                    <TbOutlineCheck size={16} />
                  </Show>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

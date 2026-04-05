import { createSignal, Show } from "solid-js";
import { i18n } from "./i18n";
import { TbOutlineGlobe, TbOutlineCheck } from "solid-icons/tb";

interface LanguageSwitcherProps {
  class?: string;
}

export function LanguageSwitcher(props: LanguageSwitcherProps) {
  const [isOpen, setIsOpen] = createSignal(false);

  const currentLocaleName = () => i18n.localeNames[i18n.locale()];

  const handleLocaleChange = (locale: "en" | "zh-CN") => {
    i18n.setLocale(locale);
    setIsOpen(false);
  };

  return (
    <div class={`relative ${props.class || ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class="hover:bg-base-content/10 flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
      >
        <TbOutlineGlobe size={18} />
        <span class="hidden text-sm font-medium sm:inline">
          {currentLocaleName()}
        </span>
      </button>

      <Show when={isOpen()}>
        <div class="bg-base-100 border-base-200 absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-xl border shadow-xl">
          <div class="p-2">
            <div class="text-base-content/60 px-3 py-2 text-xs font-semibold tracking-wide uppercase">
              Language
            </div>
            <div class="space-y-1">
              {i18n.availableLocales.map((locale) => (
                <button
                  type="button"
                  onClick={() => handleLocaleChange(locale)}
                  class={`flex w-full items-center justify-between rounded-lg px-3 py-2 transition-colors ${
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

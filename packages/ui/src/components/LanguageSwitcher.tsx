import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { FiChevronDown } from "solid-icons/fi";
import { i18n } from "@sendme/shared";
import { cn } from "../utils/cn";
import { TbOutlineCheck } from "solid-icons/tb";
import { FaSolidLanguage } from "solid-icons/fa";

interface LanguageSwitcherProps {
  class?: string;
}

export function LanguageSwitcher(props: LanguageSwitcherProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [menuStyle, setMenuStyle] = createSignal<Record<string, string>>({});
  let buttonRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const currentLocaleName = () => i18n.localeNames[i18n.locale()];

  const handleLocaleChange = (locale: "en" | "zh-CN") => {
    i18n.setLocale(locale);
    setIsOpen(false);
  };

  const updateMenuPosition = () => {
    if (!buttonRef) return;

    const rect = buttonRef.getBoundingClientRect();
    const menuHeight = menuRef?.offsetHeight ?? 152;
    const menuWidth = Math.max(buttonRef.offsetWidth, 192);
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
        <FaSolidLanguage size={18} />
        <span class="hidden text-sm font-medium sm:inline">
          {currentLocaleName()}
        </span>
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
            class="bg-base-100 border-base-200 z-120 overflow-hidden rounded-xl border shadow-xl"
          >
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
        </Portal>
      </Show>
    </div>
  );
}

import { Component, JSX, Show, createSignal } from "solid-js";
import { ChevronDown } from "lucide-solid";

interface RecipientGroupProps {
  icon: JSX.Element;
  title: string;
  badge: string;
  badgeClass?: string;
  subtitle?: string;
  /** Controlled open state. Falls back to internal state when omitted. */
  open?: boolean;
  onToggle?: () => void;
  children: JSX.Element;
}

/**
 * Collapsible group inside the unified recipient list. The header carries the
 * channel identity (title + transport badge) so the user never has to pick a
 * protocol up front — the channel is a property of the recipient, not a tab.
 */
export const RecipientGroup: Component<RecipientGroupProps> = (props) => {
  const [internalOpen, setInternalOpen] = createSignal(true);
  const isOpen = () => props.open ?? internalOpen();
  const toggle = () =>
    props.onToggle ? props.onToggle() : setInternalOpen(!internalOpen());

  return (
    <div class="border-base-300/70 bg-base-100/60 rounded-2xl border">
      <button
        type="button"
        onClick={toggle}
        class="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={isOpen()}
      >
        <span class="bg-base-200 text-base-content/70 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
          {props.icon}
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-2">
            <span class="truncate text-sm font-semibold">{props.title}</span>
            <span
              class={`badge badge-sm rounded-full font-medium ${props.badgeClass ?? "badge-ghost"}`}
            >
              {props.badge}
            </span>
          </span>
          <Show when={props.subtitle}>
            <span class="text-base-content/55 mt-0.5 block truncate text-xs">
              {props.subtitle}
            </span>
          </Show>
        </span>
        <ChevronDown
          size={16}
          class={`text-base-content/50 shrink-0 transition-transform duration-200 ${isOpen() ? "rotate-180" : ""}`}
        />
      </button>
      <Show when={isOpen()}>
        <div class="border-base-300/60 border-t px-4 pt-4 pb-4">
          {props.children}
        </div>
      </Show>
    </div>
  );
};

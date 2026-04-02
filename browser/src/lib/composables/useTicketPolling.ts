/**
 * useTicketPolling Composable
 * Now backed by WebSocket push instead of setInterval polling.
 * Kept for backwards-compatible API surface used by ReceiveTab.tsx.
 */

import { createEffect, createSignal } from "solid-js";
import { useWebSocket } from "./useWebSocket";
import type { Ticket } from "./useWebSocket";

export type { Ticket };

/**
 * useTicketPolling Hook
 *
 * @param enabled - Whether to surface tickets (e.g., only when Receive tab is active)
 * @returns Object with tickets signal, loading state, and markReceived helper
 */
export function useTicketPolling(enabled: () => boolean, _interval?: number) {
  const { tickets: allTickets, isConnected, markTicketReceived } = useWebSocket();

  // Filtered tickets — only expose when the tab is active
  const [tickets, setTickets] = createSignal<Ticket[]>([]);

  createEffect(() => {
    if (enabled()) {
      setTickets(allTickets());
    } else {
      setTickets([]);
    }
  });

  // Keep in sync with WS pushes whenever the tab is active
  createEffect(() => {
    if (enabled()) {
      setTickets(allTickets());
    }
  });

  const markReceived = (ticketId: string) => markTicketReceived(ticketId);

  return {
    tickets,
    isLoading: () => !isConnected(),
    error: () => null as string | null,
    fetchTickets: () => {
      // No-op: data arrives via WS push
    },
    markReceived,
    startPolling: () => {
      // No-op
    },
    stopPolling: () => {
      // No-op
    },
  };
}

/**
 * useTicketPolling Composable
 * Polls for incoming tickets from other devices
 */

import { createSignal, createEffect, onCleanup } from "solid-js";
import { useAuth } from "../contexts/user-better-auth";

/**
 * Ticket interface
 */
export interface Ticket {
  id: string;
  userId: string;
  fromDeviceId: string;
  ticket: string;
  filename: string | null;
  fileSize: number | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
}

/**
 * Get current device ID from localStorage
 */
function getCurrentDeviceId(): string {
  let deviceId = localStorage.getItem("sendme_device_id");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("sendme_device_id", deviceId);
  }
  return deviceId;
}

/**
 * useTicketPolling Hook
 *
 * Polls for tickets sent to the current device
 * @param enabled - Whether polling should be active (e.g., only when Receive tab is active)
 * @param interval - Polling interval in milliseconds (default: 5000)
 * @returns Object with tickets signal and loading state
 */
export function useTicketPolling(enabled: () => boolean, interval: number = 5000) {
  const [tickets, setTickets] = createSignal<Ticket[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const auth = useAuth();
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Fetch tickets for current device
   */
  const fetchTickets = async () => {
    if (!auth.isAuthenticated()) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const deviceId = getCurrentDeviceId();
      const response = await fetch(`/api/tickets?deviceId=${deviceId}`);

      if (!response.ok) {
        throw new Error("Failed to fetch tickets");
      }

      const data = (await response.json()) as Ticket[];
      setTickets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tickets");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Mark ticket as received
   */
  const markReceived = async (ticketId: string) => {
    try {
      const response = await fetch(`/api/tickets/${ticketId}/receive`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to mark ticket as received");
      }

      // Remove from local list
      setTickets((prev) => prev.filter((t) => t.id !== ticketId));
      return true;
    } catch (err) {
      console.error("Failed to mark ticket as received:", err);
      return false;
    }
  };

  /**
   * Start polling
   */
  const startPolling = () => {
    // Fetch immediately
    fetchTickets();

    // Set up interval
    pollTimer = setInterval(fetchTickets, interval);
  };

  /**
   * Stop polling
   */
  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  // Start/stop polling based on enabled signal and auth state
  createEffect(() => {
    const isEnabled = enabled();
    const isAuthenticated = auth.isAuthenticated();

    if (isEnabled && isAuthenticated) {
      startPolling();
    } else {
      stopPolling();
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    stopPolling();
  });

  return {
    tickets,
    isLoading,
    error,
    fetchTickets,
    markReceived,
    startPolling,
    stopPolling,
  };
}

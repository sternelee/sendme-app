/**
 * useWebSocket Composable
 * Manages a single persistent WebSocket connection to the user's Durable Object.
 * Replaces setInterval-based polling for both devices and tickets.
 *
 * Usage:
 *   const { devices, tickets, isConnected, markTicketReceived } = useWebSocket();
 */

import { createSignal, createEffect, onCleanup, batch } from "solid-js";
import { useAuth } from "clerk-solidjs";
import type { Device, Ticket } from "~/lib/db/schema";

export type { Device, Ticket };

// Inbound message types from the server
type ServerMessageDevices = { type: "devices"; data: Device[] };
type ServerMessageTickets = { type: "tickets"; data: Ticket[] };
type ServerMessageDeviceUpdate = { type: "device_update"; data: Partial<Device> & { id: string } };
type ServerMessagePong = { type: "pong" };
type ServerMessageError = { type: "error"; data: string };
type ServerMessage =
  | ServerMessageDevices
  | ServerMessageTickets
  | ServerMessageDeviceUpdate
  | ServerMessagePong
  | ServerMessageError;

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Get or generate the persistent local device ID
 */
export function getDeviceId(): string {
  let id = localStorage.getItem("sendme_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("sendme_device_id", id);
  }
  return id;
}

let sharedInstance: ReturnType<typeof createWebSocketStore> | null = null;

/**
 * Internal store — created once, shared across all consumers
 */
function createWebSocketStore() {
  const [devices, setDevices] = createSignal<Device[]>([]);
  const [tickets, setTickets] = createSignal<Ticket[]>([]);
  const [isConnected, setIsConnected] = createSignal(false);

  let ws: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let destroyed = false;

  const auth = useAuth();

  const connect = async () => {
    if (destroyed) return;

    const token = await auth.getToken();
    if (!token) {
      // Not signed in yet — retry after a short delay
      scheduleReconnect();
      return;
    }

    const deviceId = getDeviceId();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    // Browsers can't set custom headers on WebSocket connections,
    // so the Clerk JWT is passed as a query parameter.
    const urlWithToken = `${protocol}//${location.host}/api/ws?deviceId=${encodeURIComponent(deviceId)}&token=${encodeURIComponent(token)}`;

    try {
      ws = new WebSocket(urlWithToken);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      reconnectAttempts = 0;
      setIsConnected(true);
      startHeartbeat();
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        handleMessage(msg);
      } catch {
        console.error("[useWebSocket] Failed to parse message");
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      stopHeartbeat();
      if (!destroyed) scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will also fire; just log
      console.warn("[useWebSocket] WebSocket error");
    };
  };

  const handleMessage = (msg: ServerMessage) => {
    switch (msg.type) {
      case "devices":
        setDevices(msg.data);
        break;
      case "tickets":
        setTickets(msg.data);
        break;
      case "device_update":
        setDevices((prev) =>
          prev.map((d) => (d.id === msg.data.id ? { ...d, ...msg.data } : d)),
        );
        break;
      case "pong":
        break;
      case "error":
        console.error("[useWebSocket] Server error:", msg.data);
        break;
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const destroy = () => {
    destroyed = true;
    stopHeartbeat();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
    sharedInstance = null;
  };

  /**
   * Mark a ticket as received (removes it from local state immediately,
   * then calls the API to persist the change).
   */
  const markTicketReceived = async (ticketId: string): Promise<boolean> => {
    try {
      const token = await auth.getToken();
      const res = await fetch(`/api/tickets/${ticketId}/receive`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to mark ticket received");
      // Optimistically remove from local state
      setTickets((prev) => prev.filter((t) => t.id !== ticketId));
      return true;
    } catch (err) {
      console.error("[useWebSocket] markTicketReceived failed:", err);
      return false;
    }
  };

  return { devices, tickets, isConnected, connect, destroy, markTicketReceived };
}

/**
 * useWebSocket — shared singleton hook.
 * Call this from any component; all calls share the same connection.
 */
export function useWebSocket() {
  if (!sharedInstance) {
    sharedInstance = createWebSocketStore();
  }

  const instance = sharedInstance;

  // Start connection reactively when auth is ready
  createEffect(() => {
    instance.connect();
  });

  onCleanup(() => {
    // Don't destroy the singleton on individual component unmount;
    // destroy only when the whole app tears down.
  });

  return {
    devices: instance.devices,
    tickets: instance.tickets,
    isConnected: instance.isConnected,
    markTicketReceived: instance.markTicketReceived,
  };
}

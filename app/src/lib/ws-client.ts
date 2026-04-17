import { get_hostname } from "~/bindings";
import {
  extractBearerToken,
  getAuthorizationHeaderValue,
  getCloudApiUrl,
  getCloudWebSocketUrl,
  getPersistentDeviceId,
} from "~/lib/cloud-api";
import { createDeviceRegistrationGuard } from "~/lib/deviceRegistration";

export interface WebSocketFriendDevice {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  lastSeenAt: string | Date;
}

export interface WebSocketFriend {
  id: string;
  userId: string;
  friendUserId: string;
  status: "pending" | "accepted";
  createdAt: string | Date;
  updatedAt: string | Date;
  acceptedAt: string | Date | null;
  friend: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  friendDevices: WebSocketFriendDevice[];
}

type ServerMessage =
  | { type: "friends"; data: WebSocketFriend[] }
  | { type: "devices"; data: unknown[] }
  | { type: "tickets"; data: unknown[] }
  | { type: "pong" }
  | { type: "error"; data: string };

type UnsubscribeFn = () => void;

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 20;

class WSClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private _connected = false;
  private shouldReconnect = true;
  private connectPromise: Promise<void> | null = null;
  private reconnectAttempts = 0;

  private registrationGuard = createDeviceRegistrationGuard(
    async ({ token, deviceId }) => {
      const name = (await get_hostname().catch(() => "Sendme")) || "Sendme";
      const response = await fetch(getCloudApiUrl("/api/devices"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          deviceId,
          name,
          hostname: name,
        }),
      });

      if (!response.ok) {
        const message = await response.text().catch(() => "Failed to register device");
        throw new Error(message || "Failed to register device");
      }
    },
  );

  private friendsHandlers = new Set<(friends: WebSocketFriend[]) => void>();
  private errorHandlers = new Set<(err: string) => void>();

  isConnected() {
    return this._connected;
  }

  get deviceId() {
    return getPersistentDeviceId();
  }

  async connect(): Promise<void> {
    if (this._connected) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.shouldReconnect = true;
    this.connectPromise = this.openConnection();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async openConnection(): Promise<void> {
    const authorization = await getAuthorizationHeaderValue();
    const token = extractBearerToken(authorization);
    if (!token) {
      // Not authenticated yet — the app-level auth watcher will retry on sign-in
      return;
    }

    try {
      await this.registrationGuard.ensureRegistered({
        token,
        deviceId: getPersistentDeviceId(),
      });
    } catch (error) {
      console.error("[WSClient] Device registration failed:", error);
      throw error;
    }

    const wsUrl = new URL(getCloudWebSocketUrl());
    wsUrl.searchParams.set("deviceId", getPersistentDeviceId());
    wsUrl.searchParams.set("token", token);

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      try {
        this.ws = new WebSocket(wsUrl.toString());
      } catch (error) {
        reject(error);
        return;
      }

      this.ws.onopen = () => {
        settled = true;
        this._connected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        resolve();
      };

      this.ws.onclose = () => {
        const wasConnected = this._connected;
        this._connected = false;
        this.stopHeartbeat();
        this.ws = null;

        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection closed"));
          return;
        }

        if (wasConnected && this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection failed"));
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  private handleMessage(data: string) {
    try {
      const msg = JSON.parse(data) as ServerMessage;

      if (msg.type === "friends") {
        this.friendsHandlers.forEach((handler) => handler(msg.data));
        return;
      }

      if (msg.type === "error") {
        this.errorHandlers.forEach((handler) => handler(msg.data));
      }
    } catch {
      console.error("[WSClient] Failed to parse message:", data);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.shouldReconnect) {
      return;
    }

    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.warn("[WSClient] Max reconnect attempts reached");
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        console.error("[WSClient] Reconnect failed:", error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  disconnect() {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this._connected = false;
    this.reconnectAttempts = 0;
  }

  onFriends(handler: (friends: WebSocketFriend[]) => void): UnsubscribeFn {
    this.friendsHandlers.add(handler);
    return () => this.friendsHandlers.delete(handler);
  }

  onError(handler: (err: string) => void): UnsubscribeFn {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
}

let wsClientInstance: WSClient | null = null;

export function usePresenceWS(): WSClient {
  if (!wsClientInstance) {
    wsClientInstance = new WSClient();
  }
  return wsClientInstance;
}

export { WSClient };

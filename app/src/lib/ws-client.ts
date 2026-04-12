import { invoke } from "@tauri-apps/api/core";
import { get_hostname } from "~/bindings";

type ServerMessage =
  | { type: "presence_update"; user_id: string; devices: DeviceEntry[] }
  | { type: "friend_online"; user_id: string; devices: DeviceEntry[] }
  | { type: "friend_offline"; user_id: string }
  | { type: "pong" }
  | { type: "error"; message: string };

export interface DeviceEntry {
  device_id: string;
  name: string;
  online: boolean;
  last_seen: number;
}

type UnsubscribeFn = () => void;

const WS_URL = "wss://sendme-presence.workers.dev/ws";

class WSClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private token: string | null = null;
  private _connected = false;

  private friendOnlineHandlers: Set<(userId: string, devices: DeviceEntry[]) => void> = new Set();
  private friendOfflineHandlers: Set<(userId: string) => void> = new Set();
  private errorHandlers: Set<(err: string) => void> = new Set();

  private _deviceId: string | null = null;
  private _deviceName: string | null = null;

  isConnected() {
    return this._connected;
  }

  get deviceId() {
    return this._deviceId;
  }

  async connect(): Promise<void> {
    const [hostname, profile] = await Promise.all([
      get_hostname(),
      invoke<{ name: string; deviceType: string }>("get_nearby_profile"),
    ]);

    this._deviceId = hostname;
    this._deviceName = profile.name;

    const token = await invoke<string | null>("plugin:clerk|get_client_authorization_header");
    if (!token) {
      console.error("[WSClient] No auth token available");
      return;
    }
    this.token = token;

    return this.establishConnection();
  }

  private async establishConnection(): Promise<void> {
    if (!this.token) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${WS_URL}?token=${this.token}`);

        this.ws.onopen = () => {
          this._connected = true;
          this.startPing();
          this.sendRegister();
          resolve();
        };

        this.ws.onclose = () => {
          this._connected = false;
          this.stopPing();
          this.scheduleReconnect();
        };

        this.ws.onerror = () => {
          this._connected = false;
          reject(new Error("WebSocket connection failed"));
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleMessage(data: string) {
    try {
      const msg: ServerMessage = JSON.parse(data);

      if (msg.type === "friend_online") {
        this.friendOnlineHandlers.forEach((h) => h(msg.user_id, msg.devices));
      }

      if (msg.type === "friend_offline") {
        this.friendOfflineHandlers.forEach((h) => h(msg.user_id));
      }

      if (msg.type === "error") {
        this.errorHandlers.forEach((h) => h(msg.message));
      }
    } catch {
      console.error("[WSClient] Failed to parse message:", data);
    }
  }

  private sendRegister() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this._deviceId || !this._deviceName) return;

    this.ws.send(
      JSON.stringify({
        type: "register",
        device_id: this._deviceId,
        device_name: this._deviceName,
      })
    );
  }

  private startPing() {
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.establishConnection();
      } catch {
      }
    }, 5000);
  }

  disconnect() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  onFriendOnline(handler: (userId: string, devices: DeviceEntry[]) => void): UnsubscribeFn {
    this.friendOnlineHandlers.add(handler);
    return () => this.friendOnlineHandlers.delete(handler);
  }

  onFriendOffline(handler: (userId: string) => void): UnsubscribeFn {
    this.friendOfflineHandlers.add(handler);
    return () => this.friendOfflineHandlers.delete(handler);
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

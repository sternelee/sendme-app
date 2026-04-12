import type { ClientMessage, ServerMessage } from "./types";

export interface WSContext {
  userId: string;
  deviceId?: string;
  deviceName?: string;
}

export function parseClientMessage(
  raw: string | Buffer
): ClientMessage | null {
  try {
    const data = JSON.parse(raw.toString());

    if (data.type === "register" && data.device_id && data.device_name) {
      return { type: "register", device_id: data.device_id, device_name: data.device_name };
    }

    if (data.type === "unregister" && data.device_id) {
      return { type: "unregister", device_id: data.device_id };
    }

    if (data.type === "ping") {
      return { type: "ping" };
    }

    return null;
  } catch {
    return null;
  }
}

export function buildServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function buildError(message: string): string {
  return buildServerMessage({ type: "error", message });
}

export function buildPong(): string {
  return buildServerMessage({ type: "pong" });
}

export function buildFriendOnline(
  userId: string,
  devices: { device_id: string; name: string; online: boolean; last_seen: number }[]
): string {
  return buildServerMessage({ type: "friend_online", user_id: userId, devices });
}

export function buildFriendOffline(userId: string): string {
  return buildServerMessage({ type: "friend_offline", user_id: userId });
}

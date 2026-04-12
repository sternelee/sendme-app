/**
 * Shared types for sendme-presence Worker
 */

// ============================================================================
// DurableObjects Storage Types
// ============================================================================

export interface DeviceEntry {
  device_id: string;
  name: string;
  online: boolean;
  last_seen: number;
  ws_client_id?: string;
}

export interface PresenceState {
  user_id: string;
  devices: DeviceEntry[];
  friends: string[];
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export type ClientMessage =
  | { type: "register"; device_id: string; device_name: string }
  | { type: "unregister"; device_id: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "presence_update"; user_id: string; devices: DeviceEntry[] }
  | { type: "friend_online"; user_id: string; devices: DeviceEntry[] }
  | { type: "friend_offline"; user_id: string }
  | { type: "pong" }
  | { type: "error"; message: string };

// ============================================================================
// HTTP API Types
// ============================================================================

export interface RegisterDeviceRequest {
  device_id: string;
  device_name: string;
}

export interface PresenceUpdate {
  user_id: string;
  devices: DeviceEntry[];
  online: boolean;
}

export interface FriendsPresenceResponse {
  friends: PresenceUpdate[];
}

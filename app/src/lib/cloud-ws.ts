import WebSocket from "@tauri-apps/plugin-websocket";
import { invoke } from "@tauri-apps/api/core";
import {
  getCloudWebSocketUrl,
  getAuthorizationHeaderValue,
  refreshAuthorizationHeaderValue,
  extractBearerToken,
  getPersistentDeviceId,
  getCloudApiOrigin,
} from "./cloud-api";

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let isConnecting = false;
let shouldBeConnected = false;

function clearTimers() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

async function updateConnectionState(
  connected: boolean,
  error?: string,
) {
  const deviceId = getPersistentDeviceId();
  const apiOrigin = getCloudApiOrigin();
  try {
    await invoke("set_cloud_connected", {
      connected,
      deviceId,
      apiOrigin,
      error: error ?? null,
    });
  } catch (e) {
    console.error("[cloud-ws] Failed to update connection state:", e);
  }
}

async function handleMessage(message: { type: string; data: string | number[] }) {
  if (message.type === "Close") {
    console.log("[cloud-ws] WebSocket closed by server");
    await updateConnectionState(false, "WebSocket closed by server");
    scheduleReconnect();
    return;
  }

  if (message.type !== "Text") return;

  const text = message.data as string;
  try {
    await invoke("update_cloud_state", { messageJson: text });
  } catch (e) {
    console.error("[cloud-ws] Failed to process message:", e);
  }
}

function scheduleReconnect() {
  if (!shouldBeConnected) return;
  clearTimers();
  ws = null;

  const delayMs = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
  reconnectAttempt++;
  console.log(
    `[cloud-ws] Reconnecting in ${delayMs}ms (attempt ${reconnectAttempt})`,
  );
  reconnectTimer = setTimeout(() => {
    connectCloudWebSocket();
  }, delayMs);
}

export async function connectCloudWebSocket(): Promise<void> {
  if (isConnecting || (ws && shouldBeConnected)) return;
  shouldBeConnected = true;
  isConnecting = true;

  try {
    // Get auth token — if expired, Rust will refresh via Clerk FAPI automatically
    let authHeader = await getAuthorizationHeaderValue();
    let token = extractBearerToken(authHeader);

    // If no token returned (e.g. first time after expiry), try a forced refresh once
    if (!token) {
      console.log("[cloud-ws] No auth token on first attempt; forcing Clerk refresh");
      authHeader = await refreshAuthorizationHeaderValue();
      token = extractBearerToken(authHeader);
    }

    if (!token) {
      isConnecting = false;
      await updateConnectionState(false, "No auth token available");
      scheduleReconnect();
      return;
    }

    // Register device first
    const deviceId = getPersistentDeviceId();
    const apiOrigin = getCloudApiOrigin();
    try {
      await invoke("register_cloud_device", { deviceId, apiOrigin });
    } catch (e) {
      console.error("[cloud-ws] Device registration failed:", e);
      isConnecting = false;
      await updateConnectionState(false, `Device registration failed: ${e}`);
      scheduleReconnect();
      return;
    }

    // Build WebSocket URL with query params
    const wsUrl = getCloudWebSocketUrl();
    const url = new URL(wsUrl);
    url.searchParams.set("deviceId", deviceId);
    url.searchParams.set("token", token);

    // Disconnect existing
    if (ws) {
      try {
        await ws.disconnect();
      } catch (_) {}
      ws = null;
    }
    clearTimers();

    // Connect
    ws = await WebSocket.connect(url.toString());

    ws.addListener((msg) => {
      handleMessage(msg);
    });

    reconnectAttempt = 0;
    isConnecting = false;
    await updateConnectionState(true);

    // Start heartbeat
    heartbeatTimer = setInterval(async () => {
      if (!ws) return;
      try {
        await ws.send(JSON.stringify({ type: "heartbeat" }));
      } catch (e) {
        console.error("[cloud-ws] Heartbeat failed:", e);
        await updateConnectionState(false, `Heartbeat failed: ${e}`);
        scheduleReconnect();
      }
    }, 30000);
  } catch (e) {
    console.error("[cloud-ws] Connection failed:", e);
    isConnecting = false;
    ws = null;
    await updateConnectionState(false, `Connection failed: ${e}`);
    scheduleReconnect();
  }
}

export async function disconnectCloudWebSocket(): Promise<void> {
  shouldBeConnected = false;
  clearTimers();
  isConnecting = false;
  reconnectAttempt = 0;

  if (ws) {
    try {
      await ws.disconnect();
    } catch (_) {}
    ws = null;
  }

  try {
    await invoke("stop_cloud_presence");
  } catch (e) {
    console.error("[cloud-ws] Failed to stop cloud presence:", e);
  }
}

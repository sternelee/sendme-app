import WebSocket from "@tauri-apps/plugin-websocket";
import { invoke } from "@tauri-apps/api/core";
import {
  getCloudWebSocketUrl,
  getCloudApiUrl,
  getAuthorizationHeaderValue,
  refreshAuthorizationHeaderValue,
  extractBearerToken,
  getPersistentDeviceId,
  getCloudApiOrigin,
  describeAuthorizationHeader,
  createAuthTraceId,
  requestCloudApi,
} from "./cloud-api";
import { debugError, debugInfo, debugWarn } from "./debug-log";

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

async function updateConnectionState(connected: boolean, error?: string) {
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
    debugError("cloud-ws", "Failed to update connection state", e);
  }
}

async function handleMessage(message: {
  type: string;
  data: string | number[];
}) {
  if (message.type === "Close") {
    debugInfo("cloud-ws", "WebSocket closed by server");
    await updateConnectionState(false, "WebSocket closed by server");
    scheduleReconnect();
    return;
  }

  if (message.type !== "Text") return;

  const text = message.data as string;
  try {
    await invoke("update_cloud_state", { messageJson: text });
  } catch (e) {
    debugError("cloud-ws", "Failed to process message", e);
  }
}

function scheduleReconnect() {
  if (!shouldBeConnected) return;
  clearTimers();
  ws = null;

  const delayMs = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
  reconnectAttempt++;
  debugInfo(
    "cloud-ws",
    `Reconnecting in ${delayMs}ms (attempt ${reconnectAttempt})`,
  );
  reconnectTimer = setTimeout(() => {
    connectCloudWebSocket();
  }, delayMs);
}

async function registerCloudDevice(
  deviceId: string,
  traceId: string,
): Promise<void> {
  const profile = await invoke<{ name: string; deviceType: string }>(
    "get_nearby_profile",
  );
  const url = getCloudApiUrl("/api/devices");

  const response = await requestCloudApi(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        deviceId,
        name: profile.name,
        hostname: profile.name,
      }),
      headers: { "Content-Type": "application/json" },
    },
    { label: "cloud-devices", traceId },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to register cloud device (${response.status}): ${body}`,
    );
  }
}

export async function connectCloudWebSocket(): Promise<void> {
  if (isConnecting || (ws && shouldBeConnected)) return;
  shouldBeConnected = true;
  isConnecting = true;

  try {
    const traceId = createAuthTraceId("cloud-ws");

    // Get auth token for WebSocket URL query param
    let authHeader = await getAuthorizationHeaderValue();
    let token = extractBearerToken(authHeader);
    debugInfo(
      "cloud-ws",
      `connect start trace=${traceId} auth=${describeAuthorizationHeader(authHeader)}`,
    );

    if (!token) {
      debugInfo(
        "cloud-ws",
        "No auth token on first attempt; forcing Clerk refresh",
      );
      authHeader = await refreshAuthorizationHeaderValue();
      token = extractBearerToken(authHeader);
      debugInfo(
        "cloud-ws",
        `auth after forced refresh trace=${traceId} auth=${describeAuthorizationHeader(authHeader)}`,
      );
    }

    if (!token) {
      debugWarn(
        "cloud-ws",
        `connect aborted trace=${traceId}: no auth token available`,
      );
      isConnecting = false;
      await updateConnectionState(false, "No auth token available");
      scheduleReconnect();
      return;
    }

    const deviceId = getPersistentDeviceId();
    debugInfo(
      "cloud-ws",
      `registering device trace=${traceId} deviceId=${deviceId} auth=${describeAuthorizationHeader(authHeader)}`,
    );

    try {
      await registerCloudDevice(deviceId, traceId);
      debugInfo("cloud-ws", `register success trace=${traceId}`);
    } catch (e) {
      debugError("cloud-ws", "Device registration failed", e);
      isConnecting = false;
      await updateConnectionState(
        false,
        `Device registration failed: ${e}`,
      );
      scheduleReconnect();
      return;
    }

    // Build WebSocket URL with query params
    const wsUrl = getCloudWebSocketUrl();
    const url = new URL(wsUrl);
    url.searchParams.set("deviceId", deviceId);
    url.searchParams.set("token", token);
    url.searchParams.set("authTraceId", traceId);
    debugInfo(
      "cloud-ws",
      `opening websocket trace=${traceId} url=${wsUrl} deviceId=${deviceId} auth=${describeAuthorizationHeader(authHeader)}`,
    );

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
    debugInfo("cloud-ws", `websocket connected successfully trace=${traceId}`);

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
        debugError("cloud-ws", "Heartbeat failed", e);
        await updateConnectionState(false, `Heartbeat failed: ${e}`);
        scheduleReconnect();
      }
    }, 30000);
  } catch (e) {
    debugError("cloud-ws", "Connection failed", e);
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
    debugError("cloud-ws", "Failed to stop cloud presence", e);
  }
}

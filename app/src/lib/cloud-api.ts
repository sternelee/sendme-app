import { invoke } from "@tauri-apps/api/core";

const DEFAULT_BROWSER_API_ORIGIN = "https://sendme.leeapp.dev";
const DEVICE_ID_STORAGE_KEY = "sendme_device_id";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getCloudApiOrigin(): string {
  const configuredOrigin = import.meta.env.VITE_BROWSER_API_ORIGIN?.trim();
  return trimTrailingSlash(configuredOrigin || DEFAULT_BROWSER_API_ORIGIN);
}

export function getCloudApiBaseUrl(): string {
  return `${getCloudApiOrigin()}/api`;
}

export function getCloudApiUrl(path: string): string {
  return new URL(path, `${getCloudApiOrigin()}/`).toString();
}

export function getCloudWebSocketUrl(path: string = "/api/ws"): string {
  const url = new URL(path, `${getCloudApiOrigin()}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function getPersistentDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  }
  return deviceId;
}

export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export function normalizeAuthorizationHeader(
  authorizationHeader: string | null,
): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const trimmed = authorizationHeader.trim();
  if (!trimmed) {
    return null;
  }

  const token = extractBearerToken(trimmed);
  if (token) {
    return `Bearer ${token}`;
  }

  return `Bearer ${trimmed}`;
}

export async function getAuthorizationHeaderValue(): Promise<string | null> {
  try {
    const header = await invoke<string | null>("get_cloud_authorization_header");
    return normalizeAuthorizationHeader(header);
  } catch (error) {
    console.error("[cloud-api] Failed to get authorization header:", error);
    return null;
  }
}

/**
 * Force-clear the cached token and get a fresh one from Clerk via FAPI.
 * Use this after a 401 response to recover from a revoked/rotated token.
 */
export async function refreshAuthorizationHeaderValue(): Promise<string | null> {
  try {
    await invoke("clear_cloud_authorization_header");
    return await getAuthorizationHeaderValue();
  } catch (error) {
    console.error("[cloud-api] Failed to refresh authorization header:", error);
    return null;
  }
}

export async function getAuthorizationHeaders(): Promise<HeadersInit> {
  const authorization = await getAuthorizationHeaderValue();
  return authorization ? { Authorization: authorization } : {};
}

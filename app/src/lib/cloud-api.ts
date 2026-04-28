import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { debugError, debugInfo, debugWarn } from "./debug-log";

// ---------------------------------------------------------------------------
// Token provider — injected by AuthProvider via initCloudApi()
// ---------------------------------------------------------------------------
let _getToken: () => Promise<string | null> = () => Promise.resolve(null);

/**
 * Called once from AuthProvider after the Clerk instance is ready.
 * After this point every outgoing cloud request obtains its token directly
 * from Clerk JS, with no Rust IPC hop.
 */
export function initCloudApi(getToken: () => Promise<string | null>): void {
  _getToken = getToken;
}

const DEFAULT_BROWSER_API_ORIGIN = "https://sendme.leeapp.dev";
const DEVICE_ID_STORAGE_KEY = "sendme_device_id";

export function createAuthTraceId(label = "cloud"): string {
  const suffix = crypto.randomUUID().split("-")[0];
  return `${label}-${Date.now().toString(36)}-${suffix}`;
}

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

export function extractBearerToken(
  authorizationHeader: string | null,
): string | null {
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

export function describeAuthorizationHeader(
  authorizationHeader: string | null,
): string {
  if (!authorizationHeader) {
    return "none";
  }

  const normalized = normalizeAuthorizationHeader(authorizationHeader);
  const token = extractBearerToken(normalized);
  if (!token) {
    return "invalid";
  }

  const prefix = token.slice(0, 10);
  const suffix = token.slice(-6);
  return `len=${token.length},prefix=${prefix},suffix=${suffix}`;
}

export async function getAuthorizationHeaderValue(): Promise<string | null> {
  const token = await _getToken();
  if (!token) return null;
  return `Bearer ${token}`;
}

/**
 * Clerk JS refreshes tokens automatically; calling getToken() again is sufficient.
 */
export async function refreshAuthorizationHeaderValue(): Promise<
  string | null
> {
  return getAuthorizationHeaderValue();
}

export async function requestCloudApi(
  input: string,
  init: RequestInit = {},
  options: {
    retryOnUnauthorized?: boolean;
    skipAuthorization?: boolean;
    label?: string;
    traceId?: string;
  } = {},
): Promise<Response> {
  const {
    retryOnUnauthorized = true,
    skipAuthorization = false,
    label = "cloud-api",
    traceId,
  } = options;
  const headers = new Headers(init.headers ?? {});

  if (traceId && !headers.has("X-Auth-Trace-Id")) {
    headers.set("X-Auth-Trace-Id", traceId);
  }

  if (!skipAuthorization && !headers.has("Authorization")) {
    const authorization = await getAuthorizationHeaderValue();
    if (authorization) {
      headers.set("Authorization", authorization);
    }
  }

  const run = () =>
    tauriFetch(input, {
      ...init,
      headers,
    });

  debugInfo(
    label,
    `request ${init.method ?? "GET"} ${input} trace=${traceId ?? "none"} auth=${describeAuthorizationHeader(headers.get("Authorization"))}`,
  );
  let response = await run();
  debugInfo(
    label,
    `response ${response.status} ${input} trace=${traceId ?? "none"} auth=${describeAuthorizationHeader(headers.get("Authorization"))}`,
  );

  if (skipAuthorization || !retryOnUnauthorized || response.status !== 401) {
    return response;
  }

  debugWarn(
    label,
    `received 401, attempting auth refresh for ${input} trace=${traceId ?? "none"}`,
  );
  const refreshedAuthorization = await refreshAuthorizationHeaderValue();
  if (!refreshedAuthorization) {
    debugWarn(
      label,
      `auth refresh produced no token for ${input} trace=${traceId ?? "none"}`,
    );
    return response;
  }

  headers.set("Authorization", refreshedAuthorization);
  debugInfo(
    label,
    `retrying ${input} trace=${traceId ?? "none"} with auth=${describeAuthorizationHeader(headers.get("Authorization"))}`,
  );
  response = await run();
  debugInfo(
    label,
    `retry response ${response.status} ${input} trace=${traceId ?? "none"}`,
  );
  return response;
}

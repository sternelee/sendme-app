import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

function createJwt(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `header.${encoded}.signature`;
}

describe("cloud-api", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("uses configured browser origin for api and websocket urls", async () => {
    vi.stubEnv("VITE_BROWSER_API_ORIGIN", "https://example.com/");
    const mod = await import("~/lib/cloud-api");

    expect(mod.getCloudApiOrigin()).toBe("https://example.com");
    expect(mod.getCloudApiBaseUrl()).toBe("https://example.com/api");
    expect(mod.getCloudApiUrl("/api/devices")).toBe(
      "https://example.com/api/devices",
    );
    expect(mod.getCloudWebSocketUrl()).toBe("wss://example.com/api/ws");
  });

  it("generates and persists device id once", async () => {
    const mod = await import("~/lib/cloud-api");

    expect(mod.getPersistentDeviceId()).toBe("generated-device-id");
    expect(mod.getPersistentDeviceId()).toBe("generated-device-id");
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("extracts bearer token safely", async () => {
    const mod = await import("~/lib/cloud-api");

    expect(mod.extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(mod.extractBearerToken("bearer xyz")).toBe("xyz");
    expect(mod.extractBearerToken("Basic abc")).toBeNull();
    expect(mod.extractBearerToken(null)).toBeNull();
  });

  it("normalizes authorization headers to bearer format", async () => {
    const mod = await import("~/lib/cloud-api");

    expect(mod.normalizeAuthorizationHeader("abc123")).toBe("Bearer abc123");
    expect(mod.normalizeAuthorizationHeader("Bearer abc123")).toBe(
      "Bearer abc123",
    );
    expect(mod.normalizeAuthorizationHeader("bearer xyz")).toBe("Bearer xyz");
    expect(mod.normalizeAuthorizationHeader("   ")).toBeNull();
    expect(mod.normalizeAuthorizationHeader(null)).toBeNull();
  });

  it("returns null when no token provider has been registered", async () => {
    const mod = await import("~/lib/cloud-api");
    await expect(mod.getAuthorizationHeaderValue()).resolves.toBeNull();
  });

  it("returns bearer header from the registered token provider", async () => {
    const mod = await import("~/lib/cloud-api");
    mod.initCloudApi(async () => "test-jwt");

    await expect(mod.getAuthorizationHeaderValue()).resolves.toBe(
      "Bearer test-jwt",
    );
  });

  it("refreshAuthorizationHeaderValue delegates to getAuthorizationHeaderValue", async () => {
    const mod = await import("~/lib/cloud-api");
    mod.initCloudApi(async () => "refreshed-jwt");

    await expect(mod.refreshAuthorizationHeaderValue()).resolves.toBe(
      "Bearer refreshed-jwt",
    );
  });

  it("retries cloud requests once after a 401 with a refreshed token", async () => {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const seenAuthorizationHeaders: Array<string | null> = [];

    // Simulate token provider returning an expired token first, then a fresh one on retry
    let callCount = 0;
    const mod = await import("~/lib/cloud-api");
    mod.initCloudApi(async () => {
      callCount++;
      return callCount === 1 ? "expired-token" : "fresh-token";
    });

    vi.mocked(fetch)
      .mockImplementationOnce(async (_input, init) => {
        seenAuthorizationHeaders.push(
          new Headers(init?.headers).get("Authorization"),
        );
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
        });
      })
      .mockImplementationOnce(async (_input, init) => {
        seenAuthorizationHeaders.push(
          new Headers(init?.headers).get("Authorization"),
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

    const response = await mod.requestCloudApi(
      "https://example.com/api/friends",
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(seenAuthorizationHeaders).toEqual([
      "Bearer expired-token",
      "Bearer fresh-token",
    ]);
  });
});

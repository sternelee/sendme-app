import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("cloud-api", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("uses configured browser origin for api and websocket urls", async () => {
    vi.stubEnv("VITE_BROWSER_API_ORIGIN", "https://example.com/");
    const mod = await import("~/lib/cloud-api");

    expect(mod.getCloudApiOrigin()).toBe("https://example.com");
    expect(mod.getCloudApiBaseUrl()).toBe("https://example.com/api");
    expect(mod.getCloudApiUrl("/api/devices")).toBe("https://example.com/api/devices");
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
    expect(mod.normalizeAuthorizationHeader("Bearer abc123")).toBe("Bearer abc123");
    expect(mod.normalizeAuthorizationHeader("bearer xyz")).toBe("Bearer xyz");
    expect(mod.normalizeAuthorizationHeader("   ")).toBeNull();
    expect(mod.normalizeAuthorizationHeader(null)).toBeNull();
  });

  it("loads the cloud authorization header via the dedicated Tauri command", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce("abc123");
    const mod = await import("~/lib/cloud-api");

    await expect(mod.getAuthorizationHeaderValue()).resolves.toBe("Bearer abc123");
    expect(invoke).toHaveBeenCalledWith("get_cloud_authorization_header");
  });
});

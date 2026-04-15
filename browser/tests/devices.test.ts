import { describe, expect, it } from "vitest";
import {
  ONLINE_TIMEOUT_MS,
  detectPlatform,
  generateDeviceName,
  isDeviceOnline,
  normalizeDevicePresence,
  normalizeDevicesPresence,
} from "~/lib/api/devices";

describe("devices helpers", () => {
  it("detects platform from user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Unknown UA")).toBe("web");
  });

  it("generates device names from platform and browser", () => {
    expect(generateDeviceName("mac", "Mozilla/5.0 Chrome/123.0 Safari/537.36")).toBe("mac - Chrome");
    expect(generateDeviceName("windows", "Mozilla/5.0 Firefox/124.0")).toBe("windows - Firefox");
    expect(generateDeviceName("ios", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("iPhone");
    expect(generateDeviceName("web")).toBe("Web Device");
  });

  it("computes online state from ttl", () => {
    const now = Date.now();

    expect(isDeviceOnline({ online: true, lastSeenAt: new Date(now - 1_000) }, now)).toBe(true);
    expect(isDeviceOnline({ online: true, lastSeenAt: new Date(now - ONLINE_TIMEOUT_MS - 1) }, now)).toBe(false);
    expect(isDeviceOnline({ online: false, lastSeenAt: new Date(now - 1_000) }, now)).toBe(false);
    expect(isDeviceOnline({ online: true, lastSeenAt: null }, now)).toBe(false);
  });

  it("normalizes single and multiple device presence", () => {
    const now = Date.now();
    const onlineDevice = { id: "1", online: true, lastSeenAt: new Date(now - 500) };
    const staleDevice = { id: "2", online: true, lastSeenAt: new Date(now - ONLINE_TIMEOUT_MS - 500) };

    expect(normalizeDevicePresence(staleDevice, now)).toEqual({
      ...staleDevice,
      online: false,
    });

    expect(normalizeDevicesPresence([onlineDevice, staleDevice], now)).toEqual([
      { ...onlineDevice, online: true },
      { ...staleDevice, online: false },
    ]);
  });
});

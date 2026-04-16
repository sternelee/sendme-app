import { describe, expect, it, vi } from "vitest";
import { createDeviceRegistrationGuard } from "./deviceRegistration";

describe("createDeviceRegistrationGuard", () => {
  it("registers the device only once for repeated reconnects with the same token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const guard = createDeviceRegistrationGuard(fetchImpl);

    await guard.ensureRegistered({ token: "token-1", deviceId: "device-1" });
    await guard.ensureRegistered({ token: "token-1", deviceId: "device-1" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/api/devices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-1",
      },
      body: JSON.stringify({ deviceId: "device-1" }),
    });
  });

  it("retries registration after a failed attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const guard = createDeviceRegistrationGuard(fetchImpl);

    await expect(
      guard.ensureRegistered({ token: "token-1", deviceId: "device-1" }),
    ).rejects.toThrow("Failed to register current device");

    await guard.ensureRegistered({ token: "token-1", deviceId: "device-1" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("registers again when the auth token changes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const guard = createDeviceRegistrationGuard(fetchImpl);

    await guard.ensureRegistered({ token: "token-1", deviceId: "device-1" });
    await guard.ensureRegistered({ token: "token-2", deviceId: "device-1" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("re-registers after the cache TTL expires", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    let currentTime = 0;
    const guard = createDeviceRegistrationGuard(fetchImpl, {
      now: () => currentTime,
      ttlMs: 100,
    });

    await guard.ensureRegistered({ token: "token-1", deviceId: "device-1" });

    currentTime = 99;
    await guard.ensureRegistered({ token: "token-1", deviceId: "device-1" });

    currentTime = 100;
    await guard.ensureRegistered({ token: "token-1", deviceId: "device-1" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

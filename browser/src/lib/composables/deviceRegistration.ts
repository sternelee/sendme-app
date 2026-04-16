interface DeviceRegistrationParams {
  token: string;
  deviceId: string;
}

interface DeviceRegistrationGuardOptions {
  now?: () => number;
  ttlMs?: number;
}

export interface DeviceRegistrationFetcher {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export function createDeviceRegistrationGuard(
  fetchImpl: DeviceRegistrationFetcher,
  options: DeviceRegistrationGuardOptions = {},
) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 60_000;
  let registeredKey: string | null = null;
  let registeredAt = 0;
  let inFlightKey: string | null = null;
  let inFlight: Promise<void> | null = null;

  const ensureRegistered = async ({ token, deviceId }: DeviceRegistrationParams) => {
    const requestKey = `${token}:${deviceId}`;
    const cacheIsFresh = registeredKey === requestKey && now() - registeredAt < ttlMs;

    if (cacheIsFresh) {
      return;
    }

    if (inFlight && inFlightKey === requestKey) {
      return inFlight;
    }

    const request = (async () => {
      const response = await fetchImpl("/api/devices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deviceId }),
      });

      if (!response.ok) {
        throw new Error("Failed to register current device");
      }

      registeredKey = requestKey;
      registeredAt = now();
    })();

    inFlight = request;
    inFlightKey = requestKey;

    try {
      await request;
    } finally {
      if (inFlight === request) {
        inFlight = null;
        inFlightKey = null;
      }
    }
  };

  return {
    ensureRegistered,
  };
}

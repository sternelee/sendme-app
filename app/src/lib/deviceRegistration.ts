interface DeviceRegistrationParams {
  token: string;
  deviceId: string;
}

interface DeviceRegistrationGuardOptions {
  now?: () => number;
  ttlMs?: number;
}

export type DeviceRegistrationFn = (params: DeviceRegistrationParams) => Promise<void>;

export function createDeviceRegistrationGuard(
  register: DeviceRegistrationFn,
  options: DeviceRegistrationGuardOptions = {},
) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 60_000;
  let registeredKey: string | null = null;
  let registeredAt = 0;
  let inFlightKey: string | null = null;
  let inFlight: Promise<void> | null = null;

  const ensureRegistered = async (params: DeviceRegistrationParams) => {
    const requestKey = `${params.token}:${params.deviceId}`;
    const cacheIsFresh = registeredKey === requestKey && now() - registeredAt < ttlMs;

    if (cacheIsFresh) {
      return;
    }

    if (inFlight && inFlightKey === requestKey) {
      return inFlight;
    }

    const request = (async () => {
      await register(params);
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

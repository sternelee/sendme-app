import { vi } from "vitest";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  },
  configurable: true,
});

Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: vi.fn(() => "generated-device-id"),
  },
  configurable: true,
});

Object.defineProperty(globalThis, "window", {
  value: globalThis,
  configurable: true,
});

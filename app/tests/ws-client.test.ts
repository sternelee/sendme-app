import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const getHostnameMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("~/bindings", () => ({
  get_hostname: getHostnameMock,
}));

describe("WSClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
    getHostnameMock.mockResolvedValue("MacBook Pro");
    invokeMock.mockResolvedValue("Bearer token-123");
  });

  it("delivers friends snapshot messages to subscribers", async () => {
    const { WSClient } = await import("~/lib/ws-client");
    const client = new WSClient();
    const handler = vi.fn();

    client.onFriends(handler);
    (client as any).handleMessage(
      JSON.stringify({
        type: "friends",
        data: [
          {
            id: "f1",
            userId: "u1",
            friendUserId: "u2",
            status: "accepted",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            acceptedAt: "2026-01-01T00:00:00.000Z",
            friend: {
              id: "u2",
              name: "Alex",
              email: "a@example.com",
              image: null,
            },
            friendDevices: [],
          },
        ],
      }),
    );

    expect(handler).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
    );
  });

  it("delivers websocket error messages to subscribers", async () => {
    const { WSClient } = await import("~/lib/ws-client");
    const client = new WSClient();
    const handler = vi.fn();

    client.onError(handler);
    (client as any).handleMessage(JSON.stringify({ type: "error", data: "bad token" }));

    expect(handler).toHaveBeenCalledWith("bad token");
  });

  it("sends heartbeat frames on an open socket", async () => {
    const { WSClient } = await import("~/lib/ws-client");
    const client = new WSClient();
    const send = vi.fn();

    (client as any).ws = { readyState: 1, send };
    (client as any).startHeartbeat();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "heartbeat" }));

    (client as any).stopHeartbeat();
  });
});

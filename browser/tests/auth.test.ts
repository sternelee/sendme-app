import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const mockAuth = {
  api: { getSession: getSessionMock },
};

vi.mock("~/lib/auth-server", () => ({
  createAuth: () => mockAuth,
}));

describe("auth helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns no-token when bearer header is missing", async () => {
    const { authenticateRequest } = await import("~/lib/auth");

    const result = await authenticateRequest(
      new Request("https://example.com"),
      {
        BETTER_AUTH_SECRET: "test",
        BETTER_AUTH_URL: "https://example.com",
        DB: {} as D1Database,
        USER_DO: {} as DurableObjectNamespace,
      },
    );

    expect(result).toEqual({ userId: null, status: "no-token" });
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("returns authenticated user when session is valid", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user_123" },
      session: { token: "sess_token" },
    });
    const { authenticateRequest, requireAuth } = await import("~/lib/auth");
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer sess_token" },
    });
    const env = {
      BETTER_AUTH_SECRET: "test",
      BETTER_AUTH_URL: "https://example.com",
      DB: {} as D1Database,
      USER_DO: {} as DurableObjectNamespace,
    };

    const result = await authenticateRequest(request, env);

    expect(result).toEqual({ userId: "user_123", status: "authenticated" });
    await expect(requireAuth(request, env)).resolves.toBe("user_123");
  });

  it("returns invalid-token when session is not found", async () => {
    getSessionMock.mockResolvedValue(null);
    const { authenticateRequest, requireAuth } = await import("~/lib/auth");
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer bad_token" },
    });
    const env = {
      BETTER_AUTH_SECRET: "test",
      BETTER_AUTH_URL: "https://example.com",
      DB: {} as D1Database,
      USER_DO: {} as DurableObjectNamespace,
    };

    await expect(authenticateRequest(request, env)).resolves.toEqual({
      userId: null,
      status: "invalid-token",
    });
    await expect(requireAuth(request, env)).rejects.toThrow(
      "Unauthorized: invalid-token",
    );
  });

  it("returns invalid-token when getSession throws", async () => {
    getSessionMock.mockRejectedValue(new Error("db error"));
    const { authenticateRequest } = await import("~/lib/auth");
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer sess_token" },
    });
    const env = {
      BETTER_AUTH_SECRET: "test",
      BETTER_AUTH_URL: "https://example.com",
      DB: {} as D1Database,
      USER_DO: {} as DurableObjectNamespace,
    };

    const result = await authenticateRequest(request, env);

    expect(result).toEqual({ userId: null, status: "invalid-token" });
  });
});

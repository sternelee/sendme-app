import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyTokenMock = vi.fn();

vi.mock("@clerk/backend", () => ({
  verifyToken: verifyTokenMock,
}));

describe("auth helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns no-token when bearer header is missing", async () => {
    const { authenticateRequest } = await import("~/lib/auth");

    const result = await authenticateRequest(new Request("https://example.com"), {
      DB: {} as D1Database,
      USER_DO: {} as DurableObjectNamespace,
    });

    expect(result).toEqual({ userId: null, status: "no-token" });
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it("returns missing-clerk-config when secrets are absent", async () => {
    const { authenticateRequest } = await import("~/lib/auth");

    const result = await authenticateRequest(
      new Request("https://example.com", {
        headers: { Authorization: "Bearer token-123" },
      }),
      {
        DB: {} as D1Database,
        USER_DO: {} as DurableObjectNamespace,
      },
    );

    expect(result).toEqual({ userId: null, status: "missing-clerk-config" });
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it("returns authenticated user when token verifies", async () => {
    verifyTokenMock.mockResolvedValue({ sub: "user_123" });
    const { authenticateRequest, requireAuth } = await import("~/lib/auth");
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer token-123" },
    });
    const env = {
      DB: {} as D1Database,
      USER_DO: {} as DurableObjectNamespace,
      CLERK_SECRET_KEY: "sk_test",
    };

    const result = await authenticateRequest(request, env);

    expect(result).toEqual({ userId: "user_123", status: "authenticated" });
    await expect(requireAuth(request, env)).resolves.toBe("user_123");
  });

  it("returns invalid-token when verification fails", async () => {
    verifyTokenMock.mockRejectedValue(new Error("bad token"));
    const { authenticateRequest, requireAuth } = await import("~/lib/auth");
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer token-123" },
    });
    const env = {
      DB: {} as D1Database,
      USER_DO: {} as DurableObjectNamespace,
      CLERK_SECRET_KEY: "sk_test",
    };

    await expect(authenticateRequest(request, env)).resolves.toEqual({
      userId: null,
      status: "invalid-token",
    });
    await expect(requireAuth(request, env)).rejects.toThrow("Unauthorized: invalid-token");
  });
});

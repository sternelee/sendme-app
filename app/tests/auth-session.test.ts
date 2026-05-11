import { beforeEach, describe, expect, it } from "vitest";

import {
  createCachedAuthSession,
  extractAuthCallbackData,
  hasUsableCachedAuthSession,
  isCachedAuthSessionExpired,
} from "~/lib/auth-session";

function createJwt(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `header.${encoded}.signature`;
}

describe("auth-session", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("derives session metadata from the callback token", () => {
    const token = createJwt({ sid: "sess_123", iat: 123, exp: 456 });
    const session = createCachedAuthSession(token);

    expect(session).toEqual({
      token,
      sessionId: "sess_123",
      issuedAt: 123,
      expiresAt: 456,
    });
  });

  it("parses the browser callback deep link payload", () => {
    const token = createJwt({ sid: "sess_456", iat: 1000, exp: 2000 });
    const { session, user } = extractAuthCallbackData(
      `sendme://auth/callback?token=${encodeURIComponent(token)}&session_id=sess_456&token_iat=1000&token_exp=2000&user_id=user_123&user_email=test%40example.com&user_name=Test%20User&user_image_url=https%3A%2F%2Fexample.com%2Favatar.png`,
    );

    expect(session).toEqual({
      token,
      sessionId: "sess_456",
      issuedAt: 1000,
      expiresAt: 2000,
    });
    expect(user).toEqual({
      id: "user_123",
      email: "test@example.com",
      name: "Test User",
      imageUrl: "https://example.com/avatar.png",
    });
  });

  it("marks expired sessions as unusable", () => {
    const expired = createCachedAuthSession(
      createJwt({ sid: "sess_old", exp: Math.floor(Date.now() / 1000) - 10 }),
    );

    expect(isCachedAuthSessionExpired(expired)).toBe(true);
    expect(hasUsableCachedAuthSession(expired)).toBe(false);
  });
});

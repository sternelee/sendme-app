export interface UserInfo {
  id: string;
  email: string;
  name: string;
  imageUrl?: string;
}

export interface CachedAuthSession {
  token: string;
  sessionId?: string;
  issuedAt?: number;
  expiresAt?: number;
}

export const USER_CACHE_KEY = "sendme_cached_user";
export const SESSION_CACHE_KEY = "sendme_cached_auth_session";
export const DEV_BROWSER_TOKEN_CACHE_KEY = "sendme_dev_browser_token";

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function createCachedAuthSession(
  token: string,
  overrides: Partial<CachedAuthSession> = {},
): CachedAuthSession {
  const payload = parseJwtPayload(token);
  const payloadSessionId =
    typeof payload?.sid === "string" ? payload.sid : undefined;
  const payloadIssuedAt =
    typeof payload?.iat === "number" ? payload.iat : undefined;
  const payloadExpiresAt =
    typeof payload?.exp === "number" ? payload.exp : undefined;

  return {
    token,
    sessionId: overrides.sessionId ?? payloadSessionId,
    issuedAt: overrides.issuedAt ?? payloadIssuedAt,
    expiresAt: overrides.expiresAt ?? payloadExpiresAt,
  };
}

export function isCachedAuthSessionExpired(
  session: CachedAuthSession | null | undefined,
  skewSeconds = 30,
): boolean {
  if (!session?.token) {
    return true;
  }

  if (!session.expiresAt) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds >= session.expiresAt - skewSeconds;
}

export function hasUsableCachedAuthSession(
  session: CachedAuthSession | null | undefined,
): session is CachedAuthSession {
  return !!session?.token && !isCachedAuthSessionExpired(session);
}

export function buildAuthorizationHeader(
  token: string | null | undefined,
): string | null {
  const trimmed = token?.trim();
  return trimmed ? `Bearer ${trimmed}` : null;
}

export function loadCachedUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string") {
      return parsed as UserInfo;
    }
  } catch {
    // ignore malformed cache
  }
  return null;
}

export function saveCachedUser(user: UserInfo | null): void {
  try {
    if (user) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_CACHE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function loadCachedAuthSession(): CachedAuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== "string" || !parsed.token.trim()) {
      return null;
    }
    return {
      token: parsed.token,
      sessionId:
        typeof parsed.sessionId === "string" && parsed.sessionId.trim()
          ? parsed.sessionId
          : undefined,
      issuedAt:
        typeof parsed.issuedAt === "number" && Number.isFinite(parsed.issuedAt)
          ? parsed.issuedAt
          : undefined,
      expiresAt:
        typeof parsed.expiresAt === "number" &&
        Number.isFinite(parsed.expiresAt)
          ? parsed.expiresAt
          : undefined,
    };
  } catch {
    // ignore malformed cache
  }
  return null;
}

export function saveCachedAuthSession(session: CachedAuthSession | null): void {
  try {
    if (session?.token?.trim()) {
      localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_CACHE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function loadCachedDevBrowserToken(): string | null {
  try {
    const token = localStorage.getItem(DEV_BROWSER_TOKEN_CACHE_KEY)?.trim();
    return token ? token : null;
  } catch {
    return null;
  }
}

export function saveCachedDevBrowserToken(token: string | null): void {
  try {
    if (token?.trim()) {
      localStorage.setItem(DEV_BROWSER_TOKEN_CACHE_KEY, token.trim());
    } else {
      localStorage.removeItem(DEV_BROWSER_TOKEN_CACHE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function clearCachedAuthState(): void {
  saveCachedUser(null);
  saveCachedAuthSession(null);
  saveCachedDevBrowserToken(null);
}

export function extractAuthCallbackData(url: string): {
  session: CachedAuthSession | null;
  user: UserInfo | null;
} {
  try {
    let token: string | null = null;
    let sessionId: string | null = null;
    let issuedAt: number | undefined;
    let expiresAt: number | undefined;
    let userId: string | null = null;
    let userEmail: string | null = null;
    let userName: string | null = null;
    let userImageUrl: string | null = null;

    try {
      const parsed = new URL(url);
      token = parsed.searchParams.get("token")?.trim() ?? null;
      sessionId = parsed.searchParams.get("session_id")?.trim() ?? null;
      issuedAt = parseInteger(parsed.searchParams.get("token_iat"));
      expiresAt = parseInteger(parsed.searchParams.get("token_exp"));
      userId = parsed.searchParams.get("user_id")?.trim() ?? null;
      userEmail = parsed.searchParams.get("user_email")?.trim() ?? null;
      userName = parsed.searchParams.get("user_name")?.trim() ?? null;
      userImageUrl = parsed.searchParams.get("user_image_url")?.trim() ?? null;
    } catch {
      // Fallback for environments where new URL doesn't support custom schemes
      const queryStart = url.indexOf("?");
      if (queryStart !== -1) {
        const params = new URLSearchParams(url.slice(queryStart + 1));
        token = params.get("token")?.trim() ?? null;
        sessionId = params.get("session_id")?.trim() ?? null;
        issuedAt = parseInteger(params.get("token_iat"));
        expiresAt = parseInteger(params.get("token_exp"));
        userId = params.get("user_id")?.trim() ?? null;
        userEmail = params.get("user_email")?.trim() ?? null;
        userName = params.get("user_name")?.trim() ?? null;
        userImageUrl = params.get("user_image_url")?.trim() ?? null;
      }
    }

    const session = token
      ? createCachedAuthSession(token, {
          sessionId: sessionId || undefined,
          issuedAt,
          expiresAt,
        })
      : null;

    const user = userId
      ? {
          id: userId,
          email: userEmail || "",
          name: userName || "",
          imageUrl: userImageUrl || undefined,
        }
      : null;

    return { session, user };
  } catch {
    return { session: null, user: null };
  }
}

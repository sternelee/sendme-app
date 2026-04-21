/**
 * Clerk Authentication Helper
 * Backend utilities for authenticating requests in Cloudflare Workers
 */

import { verifyToken } from "@clerk/backend";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { apiKeys } from "./db/schema";

export interface Env {
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_JWT_KEY?: string;
  DB: D1Database;
  USER_DO: DurableObjectNamespace;
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

/**
 * Authenticate a request using a verified Clerk JWT.
 * Returns the userId if authenticated, null otherwise.
 */
export async function authenticateRequest(
  request: Request,
  env: Env,
): Promise<{ userId: string | null; status: string }> {
  try {
    const sessionToken = getBearerToken(request);

    if (!sessionToken) {
      return { userId: null, status: "no-token" };
    }

    // API key authentication path
    if (sessionToken.startsWith("sk_")) {
      return await authenticateApiKey(sessionToken, env);
    }

    // Clerk JWT authentication path
    if (!env.CLERK_SECRET_KEY && !env.CLERK_JWT_KEY) {
      console.error("[Clerk Auth] Missing CLERK_SECRET_KEY or CLERK_JWT_KEY");
      return { userId: null, status: "missing-clerk-config" };
    }

    const payload = await verifyToken(sessionToken, {
      secretKey: env.CLERK_SECRET_KEY,
      jwtKey: env.CLERK_JWT_KEY,
    });

    if (!payload.sub) {
      return { userId: null, status: "invalid-token" };
    }

    return { userId: payload.sub, status: "authenticated" };
  } catch (error) {
    console.error("[Clerk Auth] Error:", error);
    return { userId: null, status: "invalid-token" };
  }
}

/**
 * Middleware-like function to check authentication
 * Returns userId if authenticated, throws error otherwise
 */
export async function requireAuth(request: Request, env: Env): Promise<string> {
  const { userId, status } = await authenticateRequest(request, env);

  if (!userId) {
    throw new Error(`Unauthorized: ${status}`);
  }

  return userId;
}

/**
 * Authenticate a request using an API key (sk_* prefix).
 * Hashes the key with SHA-256 and looks it up in the api_keys table.
 */
async function authenticateApiKey(
  token: string,
  env: Env,
): Promise<{ userId: string | null; status: string }> {
  try {
    const hash = await sha256hex(token);
    const db = drizzle(env.DB);
    const key = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hash))
      .get();

    if (!key) {
      return { userId: null, status: "invalid-api-key" };
    }

    // Check expiration
    if (key.expiresAt && key.expiresAt < new Date()) {
      return { userId: null, status: "expired-api-key" };
    }

    // Update lastUsedAt (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(apiKeys.id, key.id))
      .run();

    return { userId: key.userId, status: "authenticated" };
  } catch (error) {
    console.error("[API Key Auth] Error:", error);
    return { userId: null, status: "invalid-api-key" };
  }
}

/**
 * Compute SHA-256 hex digest of a string.
 */
async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Exported for use in API key creation endpoint.
 */
export { sha256hex };

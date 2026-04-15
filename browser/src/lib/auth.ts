/**
 * Clerk Authentication Helper
 * Backend utilities for authenticating requests in Cloudflare Workers
 */

import { verifyToken } from "@clerk/backend";

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

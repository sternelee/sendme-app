/**
 * Clerk Authentication Helper
 * Backend utilities for authenticating requests in Cloudflare Workers
 */

export interface Env {
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_JWT_KEY?: string;
}

/**
 * Decode a JWT token without verification
 * Returns the payload if valid
 */
function decodeJwt(token: string): { sub: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = parts[1];
    // Base64 decode with proper padding
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(decoded);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Authenticate a request using Clerk JWT
 * Returns the userId if authenticated, null otherwise
 */
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<{ userId: string | null; status: string }> {
  try {
    // Get the authorization header
    const authHeader = request.headers.get("authorization");
    const sessionToken = authHeader?.replace("Bearer ", "") || "";

    if (!sessionToken) {
      return { userId: null, status: "no-token" };
    }

    // Decode the JWT token
    const decoded = decodeJwt(sessionToken);

    if (!decoded || !decoded.sub) {
      return { userId: null, status: "invalid-token" };
    }

    return { userId: decoded.sub, status: "authenticated" };
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

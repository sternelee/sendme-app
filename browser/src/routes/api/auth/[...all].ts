/**
 * Better Auth API Route
 * Handles all /api/auth/* requests (sign-in, sign-up, OAuth callbacks, session, etc.)
 */

import { createAuth } from "~/lib/auth-server";
import type { Env } from "~/lib/auth";

interface CloudflareContext {
  env: Env;
}

interface RequestEvent {
  request: Request;
  nativeEvent: {
    context: {
      cloudflare: CloudflareContext;
    };
  };
}

/**
 * Extract Cloudflare env from the request event.
 * In vinxi dev mode the cloudflare context is not injected, so we
 * build a partial env from process.env and return null for DB.
 */
function getEnv(requestEvent: RequestEvent): Env | null {
  const nativeEvent = requestEvent.nativeEvent as any;
  const cloudflare = nativeEvent?.context?.cloudflare;
  if (cloudflare?.env) {
    return cloudflare.env as Env;
  }
  // vinxi dev fallback: vars from .env are available on process.env
  return {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "dev-secret",
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    BETTER_AUTH_TRUSTED_ORIGINS: process.env.BETTER_AUTH_TRUSTED_ORIGINS,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    // DB binding only exists in wrangler/cloudflare runtime
    DB: undefined as any,
    USER_DO: undefined as any,
  };
}

async function handleAuth(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = getEnv(requestEvent);
    if (!env) {
      return new Response(
        JSON.stringify({ error: "Cloudflare context not available" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!env.DB) {
      return new Response(
        JSON.stringify({
          error:
            "Database binding not available in vinxi dev mode. " +
            "Run `pnpm run preview` (or `pnpm run build && pnpm run dev:cf`) for full-stack local development.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(requestEvent.request.url);
    const path = url.pathname.replace(/^\/api\/auth/, "");

    // Custom endpoint to expose session token for Tauri/WebSocket auth.
    // The session cookie is HttpOnly so JS can't read it directly.
    if (path === "/token" && requestEvent.request.method === "GET") {
      const auth = createAuth(env);
      const session = await auth.api.getSession({
        headers: requestEvent.request.headers,
      });
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ token: session.session.token }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const auth = createAuth(env);
    return auth.handler(requestEvent.request);
  } catch (err) {
    console.error("[Auth] Handler error:", err);
    return new Response(
      JSON.stringify({
        error: "Auth handler error",
        message: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const GET = handleAuth;
export const POST = handleAuth;
export const PUT = handleAuth;
export const DELETE = handleAuth;
export const PATCH = handleAuth;
export const HEAD = handleAuth;
export const OPTIONS = handleAuth;

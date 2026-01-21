/**
 * Better Auth API Handler
 * Handles all authentication endpoints including OAuth callbacks
 * Uses better-auth's handler with per-request Cloudflare bindings
 */

import { getRequestEvent } from "solid-js/web";
import { getAuth, type Env } from "~/lib/auth";

/**
 * Cloudflare-specific event context for SolidStart
 */
interface CloudflareContext {
  env: Env;
}

/**
 * SolidStart RequestEvent interface
 */
interface SolidStartRequestEvent {
  request: Request;
  nativeEvent: {
    context: {
      cloudflare: CloudflareContext;
    };
    request: Request;
  };
}

/**
 * Get Cloudflare env from request context
 */
function getCloudflareEnv(): Env {
  const event = getRequestEvent() as SolidStartRequestEvent | undefined;
  if (!event?.nativeEvent?.context?.cloudflare?.env) {
    throw new Error("Cloudflare bindings not available");
  }
  return event.nativeEvent.context.cloudflare.env;
}

/**
 * Get auth instance (cached per request for performance)
 */
let authInstance: ReturnType<typeof getAuth> | null = null;
let lastEnvKey: string = '';

function getAuthInstance(env: Env) {
  const key = `${env.DB}-${env.BETTER_AUTH_URL}`;
  if (!authInstance || lastEnvKey !== key) {
    authInstance = getAuth(env.DB, env);
    lastEnvKey = key;
  }
  return authInstance;
}

/**
 * Create auth handler that responds to both GET and POST
 * Accesses Cloudflare D1 bindings dynamically per-request
 */
async function authHandler(requestEvent: SolidStartRequestEvent): Promise<Response> {
  try {
    const env = getCloudflareEnv();
    const auth = getAuthInstance(env);

    // The actual Request object is in requestEvent.request
    const request = requestEvent.request;

    // Call better-auth handler with the actual Request object
    const response = await auth.handler(request);
    return response;
  } catch (error) {
    console.error("[Auth] Error:", error);
    console.error("[Auth] Stack:", error instanceof Error ? error.stack : 'no stack');
    return new Response(
      JSON.stringify({
        error: true,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Export GET and POST handlers for SolidStart
 */
export async function GET(requestEvent: SolidStartRequestEvent): Promise<Response> {
  return authHandler(requestEvent);
}

export async function POST(requestEvent: SolidStartRequestEvent): Promise<Response> {
  return authHandler(requestEvent);
}

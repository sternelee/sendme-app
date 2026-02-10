/**
 * Better Auth Configuration File
 * Used by better-auth CLI for generating schemas and types
 * Handles both CLI (no env) and runtime (with env) scenarios
 */

import type {
  D1Database,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./src/lib/db/schema";

/**
 * Cloudflare bindings interface
 */
export interface CloudflareBindings {
  DB: D1Database;
  SESSION_KV: KVNamespace;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_APP_URL?: string;
  BETTER_AUTH_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

/**
 * Create auth instance with Cloudflare bindings
 *
 * @param env - Cloudflare bindings (optional for CLI)
 * @param cf - Cloudflare request properties (optional)
 * @returns Better auth instance
 */
function createAuth(
  env?: CloudflareBindings,
  cf?: IncomingRequestCfProperties,
) {
  // Use actual DB for runtime, empty object for CLI
  const db = env ? drizzle(env.DB, { schema, logger: true }) : ({} as any);

  const baseURL =
    env?.BETTER_AUTH_URL || env?.BETTER_AUTH_APP_URL || "http://localhost:8788";
  const useSecureCookies = baseURL.startsWith("https://");

  return betterAuth({
    ...withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: true,
        cf: cf || {},
        // @ts-ignore - Type mismatch between drizzle versions, but runtime works correctly
        d1: env
          ? {
              db,
              options: {
                usePlural: true,
                debugLogs: true,
              },
            }
          : undefined,
        // @ts-ignore - KVNamespace type conflict between @cloudflare/workers-types versions
        kv: env?.SESSION_KV,
      },
      {
        baseURL,
        secret:
          env?.BETTER_AUTH_SECRET || "fallback-secret-change-in-production",
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: false,
        },
        socialProviders: {
          github: {
            clientId: env?.GITHUB_CLIENT_ID || "",
            clientSecret: env?.GITHUB_CLIENT_SECRET || "",
            enabled: !!(env?.GITHUB_CLIENT_ID && env?.GITHUB_CLIENT_SECRET),
          },
          google: {
            clientId: env?.GOOGLE_CLIENT_ID || "",
            clientSecret: env?.GOOGLE_CLIENT_SECRET || "",
            enabled: !!(env?.GOOGLE_CLIENT_ID && env?.GOOGLE_CLIENT_SECRET),
          },
        },
        session: {
          expiresIn: 60 * 60 * 24 * 30, // 30 days
          updateAge: 60 * 60 * 24, // 1 day
        },
        advanced: {
          cookiePrefix: "sendmd",
          useSecureCookies,
        },
        account: {
          accountLinking: {
            enabled: true,
            trustedProviders: ["github", "google"],
          },
        },
        rateLimit: {
          enabled: true,
        },
      },
    ),
    // Only add database adapter for CLI schema generation
    ...(env
      ? {}
      : {
          database: drizzleAdapter(db, {
            provider: "sqlite",
            usePlural: true,
            debugLogs: true,
          }),
        }),
  });
}

// Export for CLI schema generation
export const auth = createAuth();

// Export for runtime usage
export { createAuth };

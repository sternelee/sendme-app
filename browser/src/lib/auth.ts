/**
 * Better Auth Configuration
 * Auth instance for SolidStart integration
 * Uses better-auth-cloudflare with Cloudflare D1
 */

import type { IncomingRequestCfProperties } from "@cloudflare/workers-types";
import { createAuth as createAuthInstance, type CloudflareBindings } from "../../better-auth.config";

/**
 * Environment variables for Cloudflare Workers
 */
export interface Env {
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
 * Get auth instance with Cloudflare bindings
 * This is the runtime auth instance that connects to D1 database
 *
 * @param d1Database - D1 database binding
 * @param env - Environment variables (optional, will be inferred from bindings)
 * @param cf - Cloudflare request properties (optional)
 * @returns Better auth instance
 */
export function getAuth(
  d1Database: D1Database,
  env?: Partial<Env>,
  cf?: IncomingRequestCfProperties,
) {
  // Create Cloudflare bindings object from the D1 database and env
  const bindings: CloudflareBindings = {
    DB: d1Database,
    SESSION_KV: env?.SESSION_KV as KVNamespace,
    BETTER_AUTH_URL: env?.BETTER_AUTH_URL,
    BETTER_AUTH_APP_URL: env?.BETTER_AUTH_APP_URL,
    BETTER_AUTH_SECRET: env?.BETTER_AUTH_SECRET,
    GITHUB_CLIENT_ID: env?.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env?.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: env?.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env?.GOOGLE_CLIENT_SECRET,
  };

  return createAuthInstance(bindings, cf);
}

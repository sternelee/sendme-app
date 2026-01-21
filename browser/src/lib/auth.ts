/**
 * Better Auth Configuration
 * Auth instance for SolidStart integration
 * Uses Drizzle ORM with Cloudflare D1
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";

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
 *
 * Note: better-auth's Drizzle adapter has issues with D1 date serialization.
 * As a workaround, we use database defaults for createdAt/updatedAt.
 */
export function getAuth(d1Database: D1Database, env: Env) {
  // Create Drizzle instance with D1 binding
  const db = drizzle(d1Database, { schema });

  const baseURL = env.BETTER_AUTH_URL || env.BETTER_AUTH_APP_URL || "http://localhost:8788";
  const useSecureCookies = baseURL.startsWith("https://");
  console.log("[Auth] Initializing with baseURL:", baseURL);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    baseURL: baseURL,
    secret: env.BETTER_AUTH_SECRET || "fallback-secret-change-in-production",
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // 1 day
    },
    advanced: {
      cookiePrefix: "sendme",
      useSecureCookies,
    },
  });
}

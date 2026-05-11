/**
 * Better Auth server configuration
 * Runs on Cloudflare Workers with D1 (SQLite) via Drizzle ORM
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import { bearer } from "better-auth/plugins";
import * as schema from "./db/schema";
import type { Env } from "./auth";

export function createAuth(env: Env) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      usePlural: true,
    }),
    secret: env.BETTER_AUTH_SECRET || "",
    baseURL: env.BETTER_AUTH_URL || "",
    trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS
      ? env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")
      : env.BETTER_AUTH_URL
        ? [env.BETTER_AUTH_URL]
        : [],
    socialProviders: {
      github: env.GITHUB_CLIENT_ID
        ? {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET || "",
          }
        : undefined,
      google: env.GOOGLE_CLIENT_ID
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET || "",
          }
        : undefined,
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    advanced: {
      crossSubDomainCookies: {
        enabled: false,
      },
    },
    plugins: [bearer()],
  });
}

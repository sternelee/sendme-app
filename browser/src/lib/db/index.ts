/**
 * Database connection and utilities for Sendmd Browser App
 * Uses Drizzle ORM with Cloudflare D1
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * Get Drizzle database instance from Cloudflare D1 binding
 */
export function getDb(d1Database: D1Database) {
  return drizzle(d1Database, { schema });
}

/**
 * Database types for Cloudflare Workers environment
 */
export interface Env {
  DB: D1Database;
  SESSION_KV: KVNamespace;
}

/**
 * Re-export schema
 */
export * from "./schema";

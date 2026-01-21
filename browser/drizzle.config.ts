/**
 * Drizzle Kit Configuration
 * For generating migrations from Drizzle schema
 */

import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
} satisfies Config;

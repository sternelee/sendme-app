/**
 * Database schema for Sendme Browser App
 * Uses Drizzle ORM with Cloudflare D1 (SQLite)
 * Compatible with better-auth for OAuth support
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Users table - stores user account information
 * Compatible with better-auth
 * Note: better-auth expects table name "user" (singular)
 */
export const users = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    emailVerified: integer("emailVerified", { mode: "boolean" })
      .notNull()
      .default(false),
    username: text("username").unique(),
    name: text("name").notNull(),
    image: text("image"),
    createdAt: text("createdAt").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updatedAt").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    emailIdx: index("user_email_idx").on(table.email),
  }),
);

/**
 * Sessions table - better-auth session management
 */
export const sessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expiresAt").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    createdAt: text("createdAt").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updatedAt").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    userIdIdx: index("session_userId_idx").on(table.userId),
    tokenIdx: index("session_token_idx").on(table.token),
  }),
);

/**
 * Accounts table - OAuth provider accounts
 * Stores linked OAuth accounts (GitHub, Google, etc.)
 */
export const accounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    expiresAt: text("expiresAt"),
    password: text("password"),
    createdAt: text("createdAt").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updatedAt").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    userIdIdx: index("account_userId_idx").on(table.userId),
    providerAccountIdIdx: index("account_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
  }),
);

/**
 * Verification table - email verification and password reset
 */
export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: text("expiresAt").notNull(),
    createdAt: text("createdAt").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    identifierIdx: index("verification_identifier_idx").on(table.identifier),
  }),
);

/**
 * Transfer history table - tracks user's file transfers
 */
export const transfers = sqliteTable(
  "transfers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'send' or 'receive'
    filename: text("filename").notNull(),
    fileSize: integer("file_size").notNull(), // in bytes
    ticket: text("ticket"), // for send transfers
    status: text("status").notNull(), // 'pending', 'in_progress', 'completed', 'error', 'cancelled'
    errorMessage: text("error_message"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer("completed_at"), // Unix timestamp
  },
  (table) => ({
    userIdIdx: index("transfers_user_id_idx").on(table.userId),
    statusIdx: index("transfers_status_idx").on(table.status),
    createdAtIdx: index("transfers_created_at_idx").on(table.createdAt),
  }),
);

// Type exports - match better-auth's expected table names
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
export type Transfer = typeof transfers.$inferSelect;
export type NewTransfer = typeof transfers.$inferInsert;

// Re-export tables with singular names for better-auth compatibility
// Note: verification is already singular, users/sessions/accounts need aliasing
export const user = users;
export const session = sessions;
export const account = accounts;
// verification is already correctly named

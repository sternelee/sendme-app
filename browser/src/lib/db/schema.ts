/**
 * Database schema for Sendme Browser App
 * Uses Drizzle ORM with Cloudflare D1 (SQLite)
 * Compatible with better-auth for OAuth support
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Users table - stores user account information
 * Compatible with better-auth
 * Note: better-auth expects table name "user" (singular)
 */
export const users = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("emailVerified", { mode: "boolean" })
      .$defaultFn(() => false)
      .notNull(),
    image: text("image"),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
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
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    timezone: text("timezone"),
    city: text("city"),
    country: text("country"),
    region: text("region"),
    regionCode: text("regionCode"),
    colo: text("colo"),
    latitude: text("latitude"),
    longitude: text("longitude"),
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
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", {
      mode: "timestamp",
    }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
      mode: "timestamp",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
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
export const verifications = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

/**
 * Transfer history table - tracks user's file transfers
 * Custom table for Sendme app
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
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    userIdIdx: index("transfers_user_id_idx").on(table.userId),
    statusIdx: index("transfers_status_idx").on(table.status),
    createdAtIdx: index("transfers_created_at_idx").on(table.createdAt),
  }),
);

/**
 * Platform type enum values
 */
export const platformValues = [
  "web",
  "windows",
  "mac",
  "linux",
  "android",
  "ios",
] as const;
export type Platform = (typeof platformValues)[number];

/**
 * Devices table - tracks user login devices across platforms
 * Enables multi-device sync and online status tracking
 *
 * A device is considered "online" if lastSeenAt is within the last 5 minutes.
 */
export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Platform: web, windows, mac, linux, android, ios
    // Note: SQLite doesn't support native enum, validated at application level
    platform: text("platform").notNull(),
    // Device identifier (unique per device, e.g., browser fingerprint or device ID)
    deviceId: text("device_id").notNull(),
    // Human-readable device name
    name: text("name").notNull(),
    // Current IP address
    ipAddress: text("ip_address"),
    // Hostname/device model (e.g., "iPhone 14 Pro", "Chrome on Windows")
    hostname: text("hostname"),
    // User agent string for web browsers
    userAgent: text("user_agent"),
    // Whether device is currently online (updated via heartbeat)
    online: integer("online", { mode: "boolean" })
      .$defaultFn(() => true)
      .notNull(),
    // Last activity timestamp - used to determine if device is online
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    // Record creation time
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    // Last update time
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("devices_user_id_idx").on(table.userId),
    // Unique constraint: one device record per (userId, platform, deviceId)
    uniqueDeviceIdx: index("devices_unique_device_idx").on(
      table.userId,
      table.platform,
      table.deviceId,
    ),
    onlineIdx: index("devices_online_idx").on(table.online),
    lastSeenIdx: index("devices_last_seen_idx").on(table.lastSeenAt),
  }),
);

/**
 * Tickets table - stores tickets sent between user's devices
 * Used for device-to-device file transfer synchronization
 */
export const tickets = sqliteTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Target device ID (the device that should receive this ticket)
    fromDeviceId: text("from_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    // The actual ticket string
    ticket: text("ticket").notNull(),
    // Optional file metadata
    filename: text("filename"),
    fileSize: integer("file_size"),
    // Ticket status: pending, received, expired
    status: text("status").notNull(), // 'pending', 'received', 'expired'
    // Expiration time (tickets expire after 24 hours)
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    receivedAt: integer("received_at", { mode: "timestamp" }),
  },
  (table) => ({
    userIdIdx: index("tickets_user_id_idx").on(table.userId),
    fromDeviceIdx: index("tickets_from_device_idx").on(table.fromDeviceId),
    statusIdx: index("tickets_status_idx").on(table.status),
    expiresAtIdx: index("tickets_expires_at_idx").on(table.expiresAt),
  }),
);

// Type exports - match better-auth's expected table names
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
export type Transfer = typeof transfers.$inferSelect;
export type NewTransfer = typeof transfers.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;

// Re-export tables with singular names for better-auth compatibility
export const user = users;
export const session = sessions;
export const account = accounts;
// verification is already correctly named

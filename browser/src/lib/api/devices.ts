/**
 * Device API Utilities
 * Helper functions for device management operations
 */

import { and, desc, eq, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { devices, type Device, type NewDevice, type Platform } from "~/lib/db/schema";

/**
 * Generate a unique ID using crypto.randomUUID
 * Available in Cloudflare Workers and modern browsers
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Device heartbeat timeout - devices older than this are considered offline
 */
export const ONLINE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type PresenceLike = {
  lastSeenAt: Date | string | null;
  online: boolean;
};

type Db = ReturnType<typeof drizzle<typeof schema>>;

export function isDeviceOnline(device: PresenceLike, now = Date.now()): boolean {
  if (!device.online || !device.lastSeenAt) {
    return false;
  }

  return now - new Date(device.lastSeenAt).getTime() < ONLINE_TIMEOUT_MS;
}

export function normalizeDevicePresence<T extends PresenceLike>(device: T, now = Date.now()): T {
  return {
    ...device,
    online: isDeviceOnline(device, now),
  };
}

export function normalizeDevicesPresence<T extends PresenceLike>(items: T[], now = Date.now()): T[] {
  return items.map((item) => normalizeDevicePresence(item, now));
}

/**
 * Get platform from user agent string
 */
export function detectPlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();

  // Mobile platforms
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";

  // Desktop platforms
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac")) return "mac";
  if (ua.includes("linux")) return "linux";

  // Default to web
  return "web";
}

/**
 * Generate a device-friendly name from platform and user agent
 */
export function generateDeviceName(platform: Platform, userAgent?: string): string {
  if (!userAgent) {
    return `${platform.charAt(0).toUpperCase() + platform.slice(1)} Device`;
  }

  const ua = userAgent.toLowerCase();

  // Browser detection
  if (ua.includes("edg/")) return `${platform} - Microsoft Edge`;
  if (ua.includes("chrome/") && !ua.includes("edg/")) return `${platform} - Chrome`;
  if (ua.includes("firefox/")) return `${platform} - Firefox`;
  if (ua.includes("safari/") && !ua.includes("chrome/")) return `${platform} - Safari`;

  // Mobile specific
  if (platform === "ios") {
    if (ua.includes("ipad")) return "iPad";
    if (ua.includes("iphone")) return "iPhone";
    if (ua.includes("ipod")) return "iPod Touch";
  }

  if (platform === "android") {
    const match = ua.match(/android\s[\d.]+;\s([^)]+)\)/);
    if (match?.[1]) {
      return match[1].trim();
    }
    return "Android Device";
  }

  return `${platform.charAt(0).toUpperCase() + platform.slice(1)} Device`;
}

export async function getUserDeviceById(
  db: Db,
  userId: string,
  id: string,
): Promise<Device | undefined> {
  return db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.id, id)))
    .get();
}

export async function getUserDeviceByPersistentId(
  db: Db,
  userId: string,
  persistentDeviceId: string,
): Promise<Device | undefined> {
  return db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.deviceId, persistentDeviceId)))
    .get();
}

export async function getUserDevices(
  db: Db,
  userId: string,
): Promise<Device[]> {
  const allDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.userId, userId))
    .orderBy(desc(devices.lastSeenAt));

  return normalizeDevicesPresence(allDevices);
}

/**
 * Get online devices for a user
 */
export async function getOnlineDevices(
  db: Db,
  userId: string,
): Promise<Device[]> {
  const cutoff = new Date(Date.now() - ONLINE_TIMEOUT_MS);
  const matchingDevices = await db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.online, true), gt(devices.lastSeenAt, cutoff)))
    .orderBy(desc(devices.lastSeenAt));

  return normalizeDevicesPresence(matchingDevices);
}

/**
 * Register or update a device
 * Creates a new device record if it doesn't exist, updates if it does
 */
export async function upsertDevice(
  db: Db,
  userId: string,
  params: {
    platform: Platform;
    deviceId: string;
    name: string;
    ipAddress?: string;
    hostname?: string;
    userAgent?: string;
  },
): Promise<Device> {
  const existing = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.userId, userId),
        eq(devices.platform, params.platform),
        eq(devices.deviceId, params.deviceId),
      ),
    )
    .get();

  const now = new Date();

  if (existing) {
    return db
      .update(devices)
      .set({
        name: params.name,
        ipAddress: params.ipAddress,
        hostname: params.hostname,
        userAgent: params.userAgent,
        online: true,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(devices.id, existing.id))
      .returning()
      .get();
  }

  const newDevice: NewDevice = {
    id: generateId(),
    userId,
    platform: params.platform,
    deviceId: params.deviceId,
    name: params.name,
    ipAddress: params.ipAddress,
    hostname: params.hostname,
    userAgent: params.userAgent,
    online: true,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };

  return db.insert(devices).values(newDevice).returning().get();
}

/**
 * Update device heartbeat (lastSeenAt timestamp)
 * Returns true if device was found and updated
 */
export async function updateDeviceHeartbeat(
  db: Db,
  deviceId: string,
  ipAddress?: string,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(devices)
    .set({
      online: true,
      lastSeenAt: now,
      updatedAt: now,
      ...(ipAddress && { ipAddress }),
    })
    .where(eq(devices.id, deviceId))
    .returning()
    .get();

  return !!result;
}

export async function updateDeviceHeartbeatByPersistentId(
  db: Db,
  userId: string,
  persistentDeviceId: string,
  ipAddress?: string,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(devices)
    .set({
      online: true,
      lastSeenAt: now,
      updatedAt: now,
      ...(ipAddress && { ipAddress }),
    })
    .where(and(eq(devices.userId, userId), eq(devices.deviceId, persistentDeviceId)))
    .returning()
    .get();

  return !!result;
}

/**
 * Mark device as offline
 */
export async function markDeviceOffline(
  db: Db,
  deviceId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(devices)
    .set({ online: false, updatedAt: now })
    .where(eq(devices.id, deviceId))
    .returning()
    .get();

  return !!result;
}

export async function markDeviceOfflineByPersistentId(
  db: Db,
  userId: string,
  persistentDeviceId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(devices)
    .set({ online: false, updatedAt: now })
    .where(and(eq(devices.userId, userId), eq(devices.deviceId, persistentDeviceId)))
    .returning()
    .get();

  return !!result;
}

/**
 * Delete a device
 */
export async function deleteDevice(
  db: Db,
  deviceId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
    .returning()
    .get();

  return !!result;
}

/**
 * Clean up offline devices older than specified days
 * Returns the number of devices deleted
 */
export async function cleanupOldDevices(
  db: Db,
  olderThanDays: number = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(devices)
    .where(and(lt(devices.lastSeenAt, cutoff), eq(devices.online, false)))
    .returning()
    .all();

  return result.length;
}

/**
 * Mark all devices for a user as offline (e.g., on logout)
 */
export async function markAllUserDevicesOffline(
  db: Db,
  userId: string,
): Promise<void> {
  await db
    .update(devices)
    .set({ online: false, updatedAt: new Date() })
    .where(eq(devices.userId, userId));
}

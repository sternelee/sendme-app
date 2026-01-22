/**
 * Device API Utilities
 * Helper functions for device management operations
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { devices, type Platform, type Device, type NewDevice } from "~/lib/db/schema";
import { eq, and, gt, lt, desc } from "drizzle-orm";

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
const ONLINE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
    // Try to extract device model from Android UA
    const match = ua.match(/android\s[\d.]+;\s([^)]+)\)/);
    if (match && match[1]) {
      return match[1].trim();
    }
    return "Android Device";
  }

  return `${platform.charAt(0).toUpperCase() + platform.slice(1)} Device`;
}

/**
 * Get all devices for a user
 */
export async function getUserDevices(
  db: ReturnType<typeof drizzle<typeof schema>>,
  userId: string,
): Promise<Device[]> {
  const allDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.userId, userId))
    .orderBy(desc(devices.lastSeenAt));

  // Update online status based on lastSeenAt
  const now = Date.now();
  return allDevices.map((device) => ({
    ...device,
    online: device.lastSeenAt
      ? now - new Date(device.lastSeenAt).getTime() < ONLINE_TIMEOUT_MS
      : false,
  }));
}

/**
 * Get online devices for a user
 */
export async function getOnlineDevices(
  db: ReturnType<typeof drizzle<typeof schema>>,
  userId: string,
): Promise<Device[]> {
  const cutoff = new Date(Date.now() - ONLINE_TIMEOUT_MS);
  return db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), gt(devices.lastSeenAt, cutoff)))
    .orderBy(desc(devices.lastSeenAt));
}

/**
 * Register or update a device
 * Creates a new device record if it doesn't exist, updates if it does
 */
export async function upsertDevice(
  db: ReturnType<typeof drizzle<typeof schema>>,
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
  // Check if device exists
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
    // Update existing device
    const updated = await db
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

    return updated;
  }

  // Create new device
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

  const inserted = await db.insert(devices).values(newDevice).returning().get();
  return inserted;
}

/**
 * Update device heartbeat (lastSeenAt timestamp)
 * Returns true if device was found and updated
 */
export async function updateDeviceHeartbeat(
  db: ReturnType<typeof drizzle<typeof schema>>,
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

/**
 * Mark device as offline
 */
export async function markDeviceOffline(
  db: ReturnType<typeof drizzle<typeof schema>>,
  deviceId: string,
): Promise<boolean> {
  const result = await db
    .update(devices)
    .set({ online: false })
    .where(eq(devices.id, deviceId))
    .returning()
    .get();

  return !!result;
}

/**
 * Delete a device
 */
export async function deleteDevice(
  db: ReturnType<typeof drizzle<typeof schema>>,
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
  db: ReturnType<typeof drizzle<typeof schema>>,
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
  db: ReturnType<typeof drizzle<typeof schema>>,
  userId: string,
): Promise<void> {
  await db.update(devices).set({ online: false }).where(eq(devices.userId, userId));
}

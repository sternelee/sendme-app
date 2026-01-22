/**
 * Devices API Routes
 * GET /api/devices - List user's devices
 * POST /api/devices - Register/update current device
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import {
  getUserDevices,
  upsertDevice,
  detectPlatform,
  generateDeviceName,
} from "~/lib/api/devices";
import { createAuth, type CloudflareBindings } from "~/../better-auth.config";

/**
 * Cloudflare context interface
 */
interface CloudflareContext {
  env: CloudflareBindings;
  cf?: IncomingRequestCfProperties;
}

interface RequestEvent {
  request: Request;
  nativeEvent: {
    context: {
      cloudflare: CloudflareContext;
    };
  };
}

/**
 * Request body for POST /api/devices
 */
interface PostDeviceBody {
  deviceId?: string;
  name?: string;
  hostname?: string;
}

/**
 * Get auth instance with Cloudflare bindings
 */
function getAuthInstance(env: CloudflareBindings, cf?: IncomingRequestCfProperties) {
  return createAuth(env, cf);
}

/**
 * GET /api/devices - List all devices for the authenticated user
 */
export async function GET(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;
    const cf = requestEvent.nativeEvent.context.cloudflare.cf;
    const auth = getAuthInstance(env, cf);

    const session = await auth.api.getSession({
      headers: requestEvent.request.headers,
    });

    if (!session) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const db = drizzle(env.DB, { schema });
    const userDevices = await getUserDevices(db, session.user.id);

    return new Response(JSON.stringify(userDevices), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Devices API] GET error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to fetch devices",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * POST /api/devices - Register or update current device
 *
 * Body:
 * {
 *   "deviceId": string,        // Unique device identifier (e.g., fingerprint)
 *   "name"?: string,           // Optional custom name
 *   "hostname"?: string,       // Optional hostname/device model
 * }
 *
 * If name is not provided, it will be auto-generated from platform and user agent.
 */
export async function POST(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;
    const cf = requestEvent.nativeEvent.context.cloudflare.cf;
    const auth = getAuthInstance(env, cf);

    const session = await auth.api.getSession({
      headers: requestEvent.request.headers,
    });

    if (!session) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    let body: PostDeviceBody = {};
    try {
      body = await requestEvent.request.json();
    } catch {
      // Empty body is okay
    }

    // Get device info from request
    const userAgent = requestEvent.request.headers.get("user-agent") || undefined;
    const ipAddress = cf?.colo || requestEvent.request.headers.get("cf-connecting-ip") || undefined;

    // Detect platform
    const platform = detectPlatform(userAgent || "");

    // Generate device ID if not provided (should come from client for persistence)
    const deviceId = body.deviceId || crypto.randomUUID();

    // Use provided name or generate one
    const deviceName =
      body.name ||
      generateDeviceName(platform, userAgent);

    const db = drizzle(env.DB, { schema });

    const device = await upsertDevice(db, session.user.id, {
      platform,
      deviceId,
      name: deviceName,
      ipAddress,
      hostname: body.hostname,
      userAgent,
    });

    return new Response(JSON.stringify(device), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Devices API] POST error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to register device",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

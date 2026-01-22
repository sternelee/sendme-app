/**
 * Device Heartbeat API Route
 * PUT /api/devices/[id]/heartbeat - Update device online status
 *
 * This endpoint should be called periodically (e.g., every 2-3 minutes)
 * to keep the device marked as online.
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { updateDeviceHeartbeat } from "~/lib/api/devices";
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
  params: {
    id: string;
  };
}

/**
 * PUT /api/devices/[id]/heartbeat - Update device heartbeat
 *
 * Body (optional):
 * {
 *   "ipAddress"?: string  // Update IP address if changed
 * }
 */
export async function PUT(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;
    const cf = requestEvent.nativeEvent.context.cloudflare.cf;
    const auth = createAuth(env, cf);

    const session = await auth.api.getSession({
      headers: requestEvent.request.headers,
    });

    if (!session) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const deviceId = requestEvent.params.id;

    // Get optional IP address from body
    let ipAddress: string | undefined;
    try {
      const body: { ipAddress?: string } = await requestEvent.request.json();
      ipAddress = body.ipAddress;
    } catch {
      // Use current request IP if body is empty
      ipAddress = cf?.colo || requestEvent.request.headers.get("cf-connecting-ip") || undefined;
    }

    const db = drizzle(env.DB, { schema });

    // Verify the device belongs to the user
    const device = await db.query.devices.findFirst({
      where: (devices, { eq, and }) =>
        and(eq(devices.id, deviceId), eq(devices.userId, session.user.id)),
    });

    if (!device) {
      return new Response(
        JSON.stringify({ error: "Device not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Update heartbeat
    const success = await updateDeviceHeartbeat(db, deviceId, ipAddress);

    if (!success) {
      return new Response(
        JSON.stringify({ error: "Failed to update heartbeat" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        deviceId,
        lastSeenAt: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Device Heartbeat API] PUT error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to update heartbeat",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

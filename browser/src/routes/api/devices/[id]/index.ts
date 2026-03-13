/**
 * Device Detail API Routes
 * DELETE /api/devices/[id] - Remove a device
 *
 * Allows users to remove a device from their account.
 * Useful for revoking access to old devices.
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { deleteDevice as deleteDeviceFromDb } from "~/lib/api/devices";
import { authenticateRequest, type Env } from "~/lib/auth";

/**
 * Cloudflare context interface
 */
interface CloudflareContext {
  env: Env;
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
 * DELETE /api/devices/[id] - Remove a device
 *
 * This will remove the device from the user's account.
 * The device will no longer be able to access the user's data.
 */
export async function DELETE(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;

    const { userId, status } = await authenticateRequest(requestEvent.request, env);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const deviceId = requestEvent.params.id;

    const db = drizzle(env.DB!, { schema });

    // Verify the device belongs to the user before deleting
    const device = await db.query.devices.findFirst({
      where: (devices, { eq, and }) =>
        and(eq(devices.id, deviceId), eq(devices.userId, userId)),
    });

    if (!device) {
      return new Response(
        JSON.stringify({ error: "Device not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Delete the device
    const success = await deleteDeviceFromDb(db, deviceId, userId);

    if (!success) {
      return new Response(
        JSON.stringify({ error: "Failed to delete device" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Device removed successfully",
        deviceId,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Device API] DELETE error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to delete device",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

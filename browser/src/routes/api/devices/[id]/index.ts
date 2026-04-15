/**
 * Device Detail API Routes
 * DELETE /api/devices/[id] - Remove a device.
 */

import { drizzle } from "drizzle-orm/d1";
import { deleteDevice as deleteDeviceFromDb } from "~/lib/api/devices";
import { authenticateRequest, type Env } from "~/lib/auth";
import * as schema from "~/lib/db/schema";

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

async function broadcastPresence(env: Env, userId: string): Promise<void> {
  try {
    const doId = env.USER_DO.idFromName(userId);
    const stub = env.USER_DO.get(doId);
    await stub.fetch(
      new Request("https://do/broadcast/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    );
  } catch (broadcastErr) {
    console.warn("[Device API] DO broadcast failed:", broadcastErr);
  }
}

export async function DELETE(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;

    const { userId, status } = await authenticateRequest(requestEvent.request, env);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const deviceId = requestEvent.params.id;
    const db = drizzle(env.DB!, { schema });

    const device = await db.query.devices.findFirst({
      where: (devices, { and, eq }) =>
        and(eq(devices.id, deviceId), eq(devices.userId, userId)),
    });

    if (!device) {
      return new Response(
        JSON.stringify({ error: "Device not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const success = await deleteDeviceFromDb(db, deviceId, userId);

    if (!success) {
      return new Response(
        JSON.stringify({ error: "Failed to delete device" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    await broadcastPresence(env, userId);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Device removed successfully",
        deviceId,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[Device API] DELETE error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to delete device",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

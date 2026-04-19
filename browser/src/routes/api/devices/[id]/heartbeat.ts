/**
 * Device Heartbeat API Route
 * PUT /api/devices/[id]/heartbeat - Update device heartbeat.
 */

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { updateDeviceHeartbeat } from "~/lib/api/devices";
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
    console.warn("[Device Heartbeat API] DO broadcast failed:", broadcastErr);
  }
}

export async function PUT(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;
    const cf = requestEvent.nativeEvent.context.cloudflare.cf;

    const { userId, status } = await authenticateRequest(requestEvent.request, env);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const deviceId = requestEvent.params.id;

    let ipAddress: string | undefined;
    try {
      const body: { ipAddress?: string } = await requestEvent.request.json();
      ipAddress = body.ipAddress;
    } catch {
      ipAddress = cf?.colo || requestEvent.request.headers.get("cf-connecting-ip") || undefined;
    }

    const db = drizzle(env.DB!, { schema });
    const deviceRows = await db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId)))
      .limit(1);
    const device = deviceRows[0];

    if (!device) {
      return new Response(
        JSON.stringify({ error: "Device not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const success = await updateDeviceHeartbeat(db, deviceId, ipAddress);

    if (!success) {
      return new Response(
        JSON.stringify({ error: "Failed to update heartbeat" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    await broadcastPresence(env, userId);

    return new Response(
      JSON.stringify({
        success: true,
        deviceId,
        lastSeenAt: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[Device Heartbeat API] PUT error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to update heartbeat",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

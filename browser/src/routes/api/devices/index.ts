/**
 * Devices API Routes
 * GET /api/devices - List user's devices
 * POST /api/devices - Register/update current device
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import {
  detectPlatform,
  generateDeviceName,
  getUserDevices,
  upsertDevice,
} from "~/lib/api/devices";
import { authenticateRequest, type Env } from "~/lib/auth";

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
}

interface PostDeviceBody {
  deviceId?: string;
  name?: string;
  hostname?: string;
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
    console.warn("[Devices API] DO broadcast failed:", broadcastErr);
  }
}

export async function GET(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;

    const { userId, status } = await authenticateRequest(requestEvent.request, env);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const db = drizzle(env.DB!, { schema });
    const userDevices = await getUserDevices(db, userId);

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
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function POST(requestEvent: RequestEvent): Promise<Response> {
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

    let body: PostDeviceBody = {};
    try {
      body = await requestEvent.request.json();
    } catch {
      // Empty body is okay
    }

    const userAgent = requestEvent.request.headers.get("user-agent") || undefined;
    const ipAddress =
      cf?.colo || requestEvent.request.headers.get("cf-connecting-ip") || undefined;
    const platform = detectPlatform(userAgent || "");
    const deviceId = body.deviceId || crypto.randomUUID();
    const deviceName = body.name || generateDeviceName(platform, userAgent);

    const db = drizzle(env.DB!, { schema });
    const device = await upsertDevice(db, userId, {
      platform,
      deviceId,
      name: deviceName,
      ipAddress,
      hostname: body.hostname,
      userAgent,
    });

    await broadcastPresence(env, userId);

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
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

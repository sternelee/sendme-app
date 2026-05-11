/**
 * WebSocket API Route
 * GET /api/ws - Upgrade to WebSocket, routed into the user's Durable Object.
 *
 * Query params:
 *   - deviceId: string (current device's persistent client-side device ID)
 *   - token: string (better-auth session token for browser WS handshakes)
 */

import { drizzle } from "drizzle-orm/d1";
import { getUserDeviceByPersistentId } from "~/lib/api/devices";
import {
  authenticateRequest,
  describeBearerToken,
  getAuthTraceId,
  type Env,
} from "~/lib/auth";
import * as schema from "~/lib/db/schema";

interface CloudflareContext {
  env: Env;
}

interface RequestEvent {
  request: Request;
  nativeEvent: {
    context: {
      cloudflare: CloudflareContext;
    };
  };
}

export async function GET(requestEvent: RequestEvent): Promise<Response> {
  const { request, nativeEvent } = requestEvent;
  const env = nativeEvent.context.cloudflare.env;
  const traceId = getAuthTraceId(request);

  if (request.headers.get("Upgrade") !== "websocket") {
    console.warn(`[WS API] Non-websocket upgrade trace=${traceId}`);
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const url = new URL(request.url);
  const tokenFromQuery = url.searchParams.get("token");
  const tokenFromHeader = request.headers.get("authorization");
  const headerToken = tokenFromHeader?.startsWith("Bearer ")
    ? tokenFromHeader.slice(7)
    : tokenFromHeader;
  console.log(
    `[WS API] handshake start trace=${traceId} token_source=${tokenFromQuery ? "query" : tokenFromHeader ? "header" : "none"} token=${describeBearerToken(tokenFromQuery || headerToken || null)}`,
  );

  const requestToAuth = tokenFromQuery
    ? new Request(request.url, {
        headers: {
          ...Object.fromEntries(request.headers),
          Authorization: `Bearer ${tokenFromQuery}`,
        },
      })
    : request;

  const { userId, status } = await authenticateRequest(requestToAuth, env);
  if (!userId) {
    console.warn(`[WS API] auth failed trace=${traceId} status=${status}`);
    return new Response(`Unauthorized: ${status}`, { status: 401 });
  }

  const persistentDeviceId =
    request.headers.get("X-Device-Id") || url.searchParams.get("deviceId");

  if (!persistentDeviceId) {
    console.warn(`[WS API] missing deviceId trace=${traceId} userId=${userId}`);
    return new Response("Missing deviceId", { status: 400 });
  }

  const db = drizzle(env.DB!, { schema });
  const currentDevice = await getUserDeviceByPersistentId(
    db,
    userId,
    persistentDeviceId,
  );
  if (!currentDevice) {
    console.warn(
      `[WS API] device not registered trace=${traceId} userId=${userId} deviceId=${persistentDeviceId}`,
    );
    return new Response("Device not registered", { status: 400 });
  }

  console.log(
    `[WS API] auth success trace=${traceId} userId=${userId} deviceId=${persistentDeviceId}`,
  );

  const id = env.USER_DO.idFromName(userId);
  const stub = env.USER_DO.get(id);
  const doUrl = new URL(
    `https://do/ws?userId=${encodeURIComponent(userId)}&deviceId=${encodeURIComponent(persistentDeviceId)}`,
  );
  doUrl.searchParams.set("authTraceId", traceId);

  return stub.fetch(
    new Request(doUrl.toString(), {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        "X-Device-Id": persistentDeviceId,
        "X-Auth-Trace-Id": traceId,
      },
    }),
  );
}

/**
 * WebSocket API Route
 * GET /api/ws - Upgrade to WebSocket, routed into the user's Durable Object.
 *
 * Query params:
 *   - deviceId: string (current device's persistent client-side device ID)
 *   - token: string (Clerk session token for browser WS handshakes)
 */

import { drizzle } from "drizzle-orm/d1";
import { getUserDeviceByPersistentId } from "~/lib/api/devices";
import { authenticateRequest, type Env } from "~/lib/auth";
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

  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const url = new URL(request.url);
  const tokenFromQuery = url.searchParams.get("token");
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
    return new Response(`Unauthorized: ${status}`, { status: 401 });
  }

  const persistentDeviceId =
    request.headers.get("X-Device-Id") || url.searchParams.get("deviceId");

  if (!persistentDeviceId) {
    return new Response("Missing deviceId", { status: 400 });
  }

  const db = drizzle(env.DB!, { schema });
  const currentDevice = await getUserDeviceByPersistentId(db, userId, persistentDeviceId);
  if (!currentDevice) {
    return new Response("Device not registered", { status: 400 });
  }

  const id = env.USER_DO.idFromName(userId);
  const stub = env.USER_DO.get(id);
  const doUrl = new URL(
    `https://do/ws?userId=${encodeURIComponent(userId)}&deviceId=${encodeURIComponent(persistentDeviceId)}`,
  );

  return stub.fetch(
    new Request(doUrl.toString(), {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        "X-Device-Id": persistentDeviceId,
      },
    }),
  );
}

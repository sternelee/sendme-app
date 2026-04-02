/**
 * WebSocket API Route
 * GET /api/ws - Upgrade to WebSocket, routed into the user's Durable Object
 *
 * Query params:
 *   - userId: string (Clerk user ID, used as DO name)
 *   - deviceId: string (current device's DB id)
 *
 * Auth: Bearer token in Authorization header
 */

import { authenticateRequest, type Env } from "~/lib/auth";

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

  // Only accept WebSocket upgrades
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const url = new URL(request.url);

  // Accept token via Authorization header OR query param (WS browsers can't set headers)
  const tokenFromQuery = url.searchParams.get("token");
  const requestToAuth =
    tokenFromQuery
      ? new Request(request.url, {
          headers: {
            ...Object.fromEntries(request.headers),
            Authorization: `Bearer ${tokenFromQuery}`,
          },
        })
      : request;

  // Authenticate
  const { userId, status } = await authenticateRequest(requestToAuth, env);
  if (!userId) {
    return new Response(`Unauthorized: ${status}`, { status: 401 });
  }

  const deviceId =
    request.headers.get("X-Device-Id") || url.searchParams.get("deviceId");

  if (!deviceId) {
    return new Response("Missing deviceId", { status: 400 });
  }

  // Route to the user's Durable Object
  const id = env.USER_DO.idFromName(userId);
  const stub = env.USER_DO.get(id);

  // Forward the WebSocket upgrade to the DO
  const doUrl = new URL(
    `https://do/ws?userId=${encodeURIComponent(userId)}&deviceId=${encodeURIComponent(deviceId)}`,
  );

  return stub.fetch(
    new Request(doUrl.toString(), {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        "X-Device-Id": deviceId,
      },
    }),
  );
}

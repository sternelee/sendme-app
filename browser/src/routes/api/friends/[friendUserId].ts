/**
 * Friends API Route - DELETE /api/friends/:friendUserId
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { friends } from "~/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
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

async function broadcastFriendUpdate(env: Env, userId: string): Promise<void> {
  try {
    const doId = env.USER_DO.idFromName(userId);
    const stub = env.USER_DO.get(doId);
    await stub.fetch(
      new Request("https://do/broadcast/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    );
  } catch (err) {
    console.warn("[Friends API] DO broadcast failed:", err);
  }
}

export async function DELETE(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;
    const { userId, status: authStatus } = await authenticateRequest(requestEvent.request, env);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: authStatus }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const url = new URL(requestEvent.request.url);
    const pathParts = url.pathname.split("/");
    const friendUserId = pathParts[pathParts.length - 1];

    if (!friendUserId) {
      return new Response(
        JSON.stringify({ error: "Missing friendUserId" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const db = drizzle(env.DB!, { schema });

    const result = await db
      .delete(friends)
      .where(
        or(
          and(eq(friends.userId, userId), eq(friends.friendUserId, friendUserId)),
          and(eq(friends.userId, friendUserId), eq(friends.friendUserId, userId)),
        ),
      );

    if ((result as any).changes === 0) {
      return new Response(
        JSON.stringify({ error: "Friendship not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    await broadcastFriendUpdate(env, userId);
    await broadcastFriendUpdate(env, friendUserId);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Friends API] DELETE error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to remove friend",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

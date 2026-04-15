/**
 * Friends API Routes
 * Handles adding, removing, listing, and accepting friends
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { friends, users } from "~/lib/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { getOnlineDevices } from "~/lib/api/devices";
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
}

/**
 * Friend with user info for response
 */
interface FriendWithUser {
  id: string;
  userId: string;
  friendUserId: string;
  status: "pending" | "accepted";
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  friend: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  friendDevices: Array<{
    id: string;
    name: string;
    platform: string;
    online: boolean;
    lastSeenAt: Date;
  }>;
}

/**
 * GET /api/friends - Get user's friends list
 *
 * Query params:
 * - status: 'pending' | 'accepted' | 'all' (default: 'accepted')
 */
export async function GET(requestEvent: RequestEvent): Promise<Response> {
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
    const filterStatus = url.searchParams.get("status") || "accepted";

    const db = drizzle(env.DB!, { schema });

    let userFriends;
    if (filterStatus === "all") {
      userFriends = await db.query.friends.findMany({
        where: or(
          eq(friends.userId, userId),
          eq(friends.friendUserId, userId),
        ),
        orderBy: [desc(friends.updatedAt)],
      });
    } else {
      userFriends = await db.query.friends.findMany({
        where: or(
          and(eq(friends.userId, userId), eq(friends.status, filterStatus)),
          and(eq(friends.friendUserId, userId), eq(friends.status, filterStatus)),
        ),
        orderBy: [desc(friends.updatedAt)],
      });
    }

    const enrichedFriends: FriendWithUser[] = [];
    for (const friendship of userFriends) {
      const friendUserId = friendship.userId === userId
        ? friendship.friendUserId
        : friendship.userId;

      const friendUser = await db.query.users.findFirst({
        where: eq(users.id, friendUserId),
        columns: { id: true, name: true, email: true, image: true },
      });

      if (!friendUser) continue;

      const friendDevicesList = (await getOnlineDevices(db, friendUserId))
        .slice(0, 10)
        .map((device) => ({
          id: device.id,
          name: device.name,
          platform: device.platform,
          online: device.online,
          lastSeenAt: device.lastSeenAt,
        }));

      enrichedFriends.push({
        ...friendship,
        status: friendship.status as "pending" | "accepted",
        friend: friendUser,
        friendDevices: friendDevicesList,
      });
    }

    return new Response(JSON.stringify(enrichedFriends), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Friends API] GET error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to fetch friends",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * POST /api/friends - Send a friend request or accept an existing one
 *
 * Body:
 * {
 *   "email": string,       // Friend's email (optional if userId provided)
 *   "userId": string,      // Friend's user ID (optional if email provided)
 * }
 */
export async function POST(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;
    const { userId, status: authStatus } = await authenticateRequest(requestEvent.request, env);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: authStatus }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await requestEvent.request.json() as { email?: string; userId?: string };

    if (!body.email && !body.userId) {
      return new Response(
        JSON.stringify({ error: "Missing email or userId" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const db = drizzle(env.DB!, { schema });

    let targetUser;
    if (body.userId) {
      targetUser = await db.query.users.findFirst({
        where: eq(users.id, body.userId),
      });
    } else if (body.email) {
      targetUser = await db.query.users.findFirst({
        where: eq(users.email, body.email),
      });
    }

    if (!targetUser) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    if (targetUser.id === userId) {
      return new Response(
        JSON.stringify({ error: "Cannot add yourself as friend" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const existingFriendship = await db.query.friends.findFirst({
      where: or(
        and(eq(friends.userId, userId), eq(friends.friendUserId, targetUser.id)),
        and(eq(friends.userId, targetUser.id), eq(friends.friendUserId, userId)),
      ),
    });

    if (existingFriendship) {
      if (existingFriendship.status === "accepted") {
        return new Response(
          JSON.stringify({ error: "Already friends" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (existingFriendship.userId === targetUser.id && existingFriendship.status === "pending") {
        const now = new Date();
        const updated = await db
          .update(friends)
          .set({ status: "accepted", updatedAt: now, acceptedAt: now })
          .where(eq(friends.id, existingFriendship.id))
          .returning()
          .get();

        await broadcastFriendUpdate(env, userId);
        await broadcastFriendUpdate(env, targetUser.id);

        return new Response(JSON.stringify({ ...updated, action: "accepted" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ error: "Friend request already sent" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const newFriendship = await db
      .insert(friends)
      .values({
        id: crypto.randomUUID(),
        userId,
        friendUserId: targetUser.id,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    await broadcastFriendUpdate(env, targetUser.id);

    return new Response(JSON.stringify({ ...newFriendship, action: "request_sent" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Friends API] POST error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to add friend",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * DELETE /api/friends/:friendUserId - Remove a friend
 */
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

/**
 * Broadcast friend list update to a user's WebSocket sessions
 */
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

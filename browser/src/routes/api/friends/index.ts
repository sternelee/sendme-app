/**
 * Friends API Routes
 * Handles adding, removing, listing, and accepting friends
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { friends, users } from "~/lib/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { getOnlineDevices } from "~/lib/api/devices";
import { authenticateRequest, getAuthTraceId, type Env } from "~/lib/auth";
import { createClerkClient } from "@clerk/backend";

/**
 * D1 may return snake_case or camelCase field names depending on the adapter version.
 * This helper reads both variants safely.
 */
function getField<T>(
  obj: Record<string, unknown>,
  camel: string,
  snake: string,
): T | undefined {
  if (obj[camel] !== undefined) return obj[camel] as T;
  if (obj[snake] !== undefined) return obj[snake] as T;
  return undefined;
}

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
    const traceId = getAuthTraceId(requestEvent.request);
    const { userId, status: authStatus } = await authenticateRequest(
      requestEvent.request,
      env,
    );

    if (!userId) {
      console.warn(
        `[Friends API] GET auth failed trace=${traceId} status=${authStatus}`,
      );
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: authStatus }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(requestEvent.request.url);
    const filterStatus = url.searchParams.get("status") || "accepted";

    console.log(
      `[Friends API] GET start trace=${traceId} userId=${userId} status=${filterStatus}`,
    );

    const db = drizzle(env.DB!, { schema });

    let userFriends;
    if (filterStatus === "all") {
      userFriends = await db
        .select()
        .from(friends)
        .where(or(eq(friends.userId, userId), eq(friends.friendUserId, userId)))
        .orderBy(desc(friends.updatedAt));
    } else {
      userFriends = await db
        .select()
        .from(friends)
        .where(
          or(
            and(eq(friends.userId, userId), eq(friends.status, filterStatus)),
            and(
              eq(friends.friendUserId, userId),
              eq(friends.status, filterStatus),
            ),
          ),
        )
        .orderBy(desc(friends.updatedAt));
    }

    const enrichedFriends: FriendWithUser[] = [];
    for (const friendship of userFriends) {
      const fUserId = getField<string>(friendship, "userId", "user_id");
      const fFriendUserId = getField<string>(
        friendship,
        "friendUserId",
        "friend_user_id",
      );
      const friendUserId = fUserId === userId ? fFriendUserId : fUserId;

      if (!friendUserId) {
        console.warn(
          "[Friends API GET] Could not determine friendUserId for friendship",
        );
        continue;
      }

      const friendUserRows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
        })
        .from(users)
        .where(eq(users.id, friendUserId))
        .limit(1);
      const friendUser = friendUserRows[0];

      // Use placeholder if user record is missing (Clerk sync may have failed)
      const resolvedFriend = friendUser ?? {
        id: friendUserId,
        name: "Unknown User",
        email: "",
        image: null as string | null,
      };

      const friendDevicesList = friendUser
        ? (await getOnlineDevices(db, friendUserId))
            .slice(0, 10)
            .map((device) => ({
              id: device.id,
              name: device.name,
              platform: device.platform,
              online: device.online,
              lastSeenAt: device.lastSeenAt,
            }))
        : [];

      const fStatus = getField<string>(friendship, "status", "status");
      enrichedFriends.push({
        ...friendship,
        status: (fStatus ?? "pending") as "pending" | "accepted",
        friend: resolvedFriend,
        friendDevices: friendDevicesList,
      });
    }

    console.log(
      `[Friends API] GET success trace=${traceId} userId=${userId} count=${enrichedFriends.length}`,
    );

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
      { status: 500, headers: { "Content-Type": "application/json" } },
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
    const traceId = getAuthTraceId(requestEvent.request);
    const { userId, status: authStatus } = await authenticateRequest(
      requestEvent.request,
      env,
    );

    if (!userId) {
      console.warn(
        `[Friends API] POST auth failed trace=${traceId} status=${authStatus}`,
      );
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: authStatus }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = (await requestEvent.request.json()) as {
      email?: string;
      userId?: string;
    };

    console.log(
      `[Friends API] POST start trace=${traceId} userId=${userId} targetEmail=${body.email ?? "none"} targetUserId=${body.userId ?? "none"}`,
    );

    if (!body.email && !body.userId) {
      return new Response(
        JSON.stringify({ error: "Missing email or userId" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const db = drizzle(env.DB!, { schema });

    let targetUser;
    if (body.userId) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, body.userId))
        .limit(1);
      targetUser = rows[0];
    } else if (body.email) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, body.email))
        .limit(1);
      targetUser = rows[0];
    }

    // Fallback: if target user is not in local DB, try to fetch from Clerk and create
    if (!targetUser && body.email && env.CLERK_SECRET_KEY) {
      try {
        const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
        const clerkUsers = await clerk.users.getUserList({
          emailAddress: [body.email],
        });
        const clerkUser = clerkUsers.data[0];
        if (clerkUser) {
          const primaryEmail = clerkUser.emailAddresses[0]?.emailAddress ?? "";
          const displayName =
            [clerkUser.firstName, clerkUser.lastName]
              .filter(Boolean)
              .join(" ") ||
            clerkUser.username ||
            primaryEmail;

          const existingRows = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, clerkUser.id))
            .limit(1);

          if (existingRows.length === 0) {
            await db.insert(users).values({
              id: clerkUser.id,
              name: displayName,
              email: primaryEmail,
              emailVerified: true,
              image: clerkUser.imageUrl,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          } else {
            await db
              .update(users)
              .set({
                name: displayName,
                email: primaryEmail,
                image: clerkUser.imageUrl,
                updatedAt: new Date(),
              })
              .where(eq(users.id, clerkUser.id));
          }

          targetUser = {
            id: clerkUser.id,
            name: displayName,
            email: primaryEmail,
            image: clerkUser.imageUrl,
          };
        }
      } catch (clerkErr) {
        console.warn("[Friends API] Clerk fallback failed:", clerkErr);
      }
    }

    if (!targetUser) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (targetUser.id === userId) {
      return new Response(
        JSON.stringify({ error: "Cannot add yourself as friend" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const existingFriendshipRows = await db
      .select()
      .from(friends)
      .where(
        or(
          and(
            eq(friends.userId, userId),
            eq(friends.friendUserId, targetUser.id),
          ),
          and(
            eq(friends.userId, targetUser.id),
            eq(friends.friendUserId, userId),
          ),
        ),
      );

    const existingFriendship = existingFriendshipRows[0] || undefined;

    if (existingFriendship) {
      const status = getField(existingFriendship, "status", "status");

      if (status === "accepted") {
        return new Response(JSON.stringify({ error: "Already friends" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Defensive field access for D1 snake_case quirk
      const incomingRequest = existingFriendshipRows.find((r) => {
        const rUserId = getField(r, "userId", "user_id");
        const rFriendUserId = getField(r, "friendUserId", "friend_user_id");
        const rStatus = getField(r, "status", "status");
        return (
          rUserId === targetUser.id &&
          rFriendUserId === userId &&
          rStatus === "pending"
        );
      });

      if (incomingRequest) {
        const incomingId = getField<string>(incomingRequest, "id", "id");

        // Accept the incoming request
        const now = new Date();
        const updatedRows = await db
          .update(friends)
          .set({ status: "accepted", updatedAt: now, acceptedAt: now })
          .where(eq(friends.id, incomingId!))
          .returning();
        const updated = updatedRows[0];

        // Also accept/clean up any reverse pending request (my request to them)
        const reverseRequest = existingFriendshipRows.find((r) => {
          const rUserId = getField<string>(r, "userId", "user_id");
          const rFriendUserId = getField<string>(
            r,
            "friendUserId",
            "friend_user_id",
          );
          const rStatus = getField<string>(r, "status", "status");
          return (
            rUserId === userId &&
            rFriendUserId === targetUser.id &&
            rStatus === "pending"
          );
        });
        if (reverseRequest) {
          const reverseId = getField<string>(reverseRequest, "id", "id");
          await db
            .update(friends)
            .set({ status: "accepted", updatedAt: now, acceptedAt: now })
            .where(eq(friends.id, reverseId!));
        }

        await broadcastFriendUpdate(env, userId);
        await broadcastFriendUpdate(env, targetUser.id);

        console.log(
          `[Friends API] POST success trace=${traceId} userId=${userId} action=accepted targetUserId=${targetUser.id}`,
        );

        return new Response(
          JSON.stringify({ ...updated, action: "accepted" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({ error: "Friend request already sent" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const now = new Date();
    const newFriendshipRows = await db
      .insert(friends)
      .values({
        id: crypto.randomUUID(),
        userId,
        friendUserId: targetUser.id,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const newFriendship = newFriendshipRows[0];

    await broadcastFriendUpdate(env, targetUser.id);
    await broadcastFriendUpdate(env, userId);

    console.log(
      `[Friends API] POST success trace=${traceId} userId=${userId} action=request_sent targetUserId=${targetUser.id}`,
    );

    return new Response(
      JSON.stringify({ ...newFriendship, action: "request_sent" }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[Friends API] POST error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to add friend",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
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

/**
 * Tickets API Routes
 * Handles sending and receiving tickets between devices
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { devices, tickets, friends } from "~/lib/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
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
 * Request body for POST /api/tickets
 */
interface PostTicketBody {
  deviceId?: string;       // Target device ID (for own device transfers)
  friendUserId?: string;   // Target friend's user ID (for friend transfers)
  fromDeviceId?: string;   // Source device ID (the device sending this ticket)
  ticket: string;          // The ticket string
  filename?: string;       // Optional filename
  fileSize?: number;       // Optional file size in bytes
}

/**
 * POST /api/tickets - Send a ticket to another device
 *
 * Body:
 * {
 *   "deviceId": string,     // Target device ID
 *   "ticket": string,       // The ticket string
 *   "filename": string,     // Optional filename
 *   "fileSize": number,     // Optional file size in bytes
 * }
 */
export async function POST(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;

    const { userId, status } = await authenticateRequest(requestEvent.request, env);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await requestEvent.request.json() as PostTicketBody;

    if (!body.ticket) {
      return new Response(
        JSON.stringify({ error: "Missing required field: ticket" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!body.deviceId && !body.friendUserId) {
      return new Response(
        JSON.stringify({ error: "Missing deviceId or friendUserId" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const db = drizzle(env.DB!, { schema });

    let targetUserId: string;
    let targetDeviceId: string | null = null;

    // Case 1: Sending to own device
    if (body.deviceId) {
      const targetDevice = await db.query.devices.findFirst({
        where: and(eq(devices.id, body.deviceId), eq(devices.userId, userId)),
      });

      if (!targetDevice) {
        return new Response(
          JSON.stringify({ error: "Device not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      if (!targetDevice.online) {
        return new Response(
          JSON.stringify({ error: "Target device is offline" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      targetUserId = userId;
      targetDeviceId = body.deviceId;
    } 
    // Case 2: Sending to a friend
    else if (body.friendUserId) {
      // Verify friendship exists and is accepted
      const friendship = await db.query.friends.findFirst({
        where: or(
          and(
            eq(friends.userId, userId),
            eq(friends.friendUserId, body.friendUserId),
            eq(friends.status, "accepted"),
          ),
          and(
            eq(friends.userId, body.friendUserId),
            eq(friends.friendUserId, userId),
            eq(friends.status, "accepted"),
          ),
        ),
      });

      if (!friendship) {
        return new Response(
          JSON.stringify({ error: "Not friends with this user or friendship not accepted" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }

      targetUserId = body.friendUserId;
      // Target device will be NULL for friend transfers - ticket goes to all friend's devices
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid target" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create ticket record (expires in 24 hours)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const fromDeviceId = body.fromDeviceId || body.deviceId || "";
    // For friend transfers, fromUserId is the current user (sender)
    // For own device transfers, fromUserId is NULL (same user)
    const fromUserId = body.friendUserId ? userId : null;
    const newTicket = await db
      .insert(schema.tickets)
      .values({
        id: crypto.randomUUID(),
        userId: targetUserId,
        fromUserId,
        fromDeviceId,
        toUserId: targetDeviceId ? null : targetUserId,
        toDeviceId: targetDeviceId,
        ticket: body.ticket,
        filename: body.filename || null,
        fileSize: body.fileSize || null,
        status: "pending",
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .get();

    // Broadcast new ticket to target user's WS sessions via DO
    try {
      const doId = env.USER_DO.idFromName(targetUserId);
      const stub = env.USER_DO.get(doId);
      await stub.fetch(
        new Request("https://do/broadcast/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: targetUserId }),
        }),
      );
    } catch (broadcastErr) {
      console.warn("[Tickets API] DO broadcast failed:", broadcastErr);
    }

    return new Response(JSON.stringify(newTicket), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Tickets API] POST error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to send ticket",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /api/tickets - Get pending tickets for current device
 *
 * Query params:
 * - deviceId: string - Current device ID
 *
 * Returns tickets sent to this device or from friends that haven't been received yet
 */
export async function GET(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;

    const { userId, status } = await authenticateRequest(requestEvent.request, env);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const url = new URL(requestEvent.request.url);
    const deviceId = url.searchParams.get("deviceId");

    if (!deviceId) {
      return new Response(
        JSON.stringify({ error: "Missing deviceId parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const db = drizzle(env.DB!, { schema });

    // Get pending tickets for this device (own device transfers)
    // OR tickets from friends (friend-to-friend transfers)
    const allPendingTickets = await db.query.tickets.findMany({
      where: and(
        eq(tickets.userId, userId),
        eq(tickets.status, "pending"),
      ),
      orderBy: [desc(schema.tickets.createdAt)],
    });

    // Filter to tickets for this specific device OR friend tickets (toDeviceId is NULL)
    const pendingTickets = allPendingTickets.filter((t) => 
      t.toDeviceId === deviceId || (t.toDeviceId === null && t.toUserId !== null)
    );

    return new Response(JSON.stringify(pendingTickets), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    },
    );
  } catch (error) {
    console.error("[Tickets API] GET error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to fetch tickets",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

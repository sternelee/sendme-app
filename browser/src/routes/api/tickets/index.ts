/**
 * Tickets API Routes
 * Handles sending and receiving tickets between devices.
 */

import { and, desc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  getUserDeviceById,
  getUserDeviceByPersistentId,
  isDeviceOnline,
} from "~/lib/api/devices";
import { authenticateRequest, type Env } from "~/lib/auth";
import * as schema from "~/lib/db/schema";
import { friends, tickets } from "~/lib/db/schema";

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

interface PostTicketBody {
  deviceId?: string;
  friendUserId?: string;
  fromDeviceId?: string;
  ticket: string;
  filename?: string;
  fileSize?: number;
}

export async function POST(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;
    const { userId, status } = await authenticateRequest(requestEvent.request, env);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = (await requestEvent.request.json()) as PostTicketBody;

    if (!body.ticket) {
      return new Response(
        JSON.stringify({ error: "Missing required field: ticket" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    if ((body.deviceId ? 1 : 0) + (body.friendUserId ? 1 : 0) !== 1) {
      return new Response(
        JSON.stringify({ error: "Provide exactly one of deviceId or friendUserId" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const db = drizzle(env.DB!, { schema });
    const currentPersistentDeviceId =
      requestEvent.request.headers.get("X-Device-Id") || body.fromDeviceId;

    if (!currentPersistentDeviceId) {
      return new Response(
        JSON.stringify({ error: "Missing current device identifier" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const currentDevice = await getUserDeviceByPersistentId(
      db,
      userId,
      currentPersistentDeviceId,
    );

    if (!currentDevice) {
      return new Response(
        JSON.stringify({ error: "Current device is not registered" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let targetUserId: string;
    let targetDeviceId: string | null = null;

    if (body.deviceId) {
      const targetDevice = await getUserDeviceById(db, userId, body.deviceId);

      if (!targetDevice) {
        return new Response(
          JSON.stringify({ error: "Device not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      if (!isDeviceOnline(targetDevice)) {
        return new Response(
          JSON.stringify({ error: "Target device is offline" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      targetUserId = userId;
      targetDeviceId = targetDevice.id;
    } else {
      const friendUserId = body.friendUserId!;
      const friendshipRows = await db
        .select()
        .from(friends)
        .where(
          or(
            and(
              eq(friends.userId, userId),
              eq(friends.friendUserId, friendUserId),
              eq(friends.status, "accepted"),
            ),
            and(
              eq(friends.userId, friendUserId),
              eq(friends.friendUserId, userId),
              eq(friends.status, "accepted"),
            ),
          ),
        )
        .limit(1);
      const friendship = friendshipRows[0];

      if (!friendship) {
        return new Response(
          JSON.stringify({ error: "Not friends with this user or friendship not accepted" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }

      targetUserId = friendUserId;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const fromUserId = body.friendUserId ? userId : null;

    const newTicket = await db
      .insert(schema.tickets)
      .values({
        id: crypto.randomUUID(),
        userId: targetUserId,
        fromUserId,
        fromDeviceId: currentDevice.id,
        toUserId: targetDeviceId ? null : targetUserId,
        toDeviceId: targetDeviceId,
        ticket: body.ticket,
        filename: body.filename || null,
        fileSize: body.fileSize || null,
        status: "pending",
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

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
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
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

    const body = (await requestEvent.request.json()) as { ticket?: string };

    if (!body.ticket) {
      return new Response(
        JSON.stringify({ error: "Missing required field: ticket" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const db = drizzle(env.DB!, { schema });

    // D1 workaround: split OR into two separate deletes to avoid
    // SQLite limitation with OR conditions in DELETE WHERE.
    await db
      .delete(schema.tickets)
      .where(and(eq(tickets.ticket, body.ticket), eq(tickets.userId, userId)))
      .run();

    await db
      .delete(schema.tickets)
      .where(and(eq(tickets.ticket, body.ticket), eq(tickets.fromUserId, userId)))
      .run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Tickets API] DELETE error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to delete ticket",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
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

    const url = new URL(requestEvent.request.url);
    const requestedDeviceId =
      url.searchParams.get("deviceId") || requestEvent.request.headers.get("X-Device-Id");

    if (!requestedDeviceId) {
      return new Response(
        JSON.stringify({ error: "Missing deviceId parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const db = drizzle(env.DB!, { schema });
    const currentDevice =
      (await getUserDeviceById(db, userId, requestedDeviceId)) ||
      (await getUserDeviceByPersistentId(db, userId, requestedDeviceId));

    const pendingTickets = await db
      .select()
      .from(tickets)
      .where(
        currentDevice
          ? and(
              eq(tickets.userId, userId),
              eq(tickets.status, "pending"),
              gt(tickets.expiresAt, new Date()),
              or(
                eq(tickets.toDeviceId, currentDevice.id),
                and(isNull(tickets.toDeviceId), isNotNull(tickets.toUserId)),
              ),
            )
          : and(
              eq(tickets.userId, userId),
              eq(tickets.status, "pending"),
              gt(tickets.expiresAt, new Date()),
              isNull(tickets.toDeviceId),
              isNotNull(tickets.toUserId),
            ),
      )
      .orderBy(desc(schema.tickets.createdAt));

    return new Response(JSON.stringify(pendingTickets), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Tickets API] GET error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to fetch tickets",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

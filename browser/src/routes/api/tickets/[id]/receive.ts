/**
 * POST /api/tickets/:id/receive
 * Marks a ticket as received (status = "received").
 */

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { authenticateRequest, type Env } from "~/lib/auth";
import * as schema from "~/lib/db/schema";
import { tickets } from "~/lib/db/schema";

interface CloudflareContext {
  env: Env;
}

interface RequestEvent {
  request: Request;
  params: { id: string };
  nativeEvent: {
    context: {
      cloudflare: CloudflareContext;
    };
  };
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

    const ticketId = requestEvent.params.id;
    if (!ticketId) {
      return new Response(
        JSON.stringify({ error: "Missing ticket ID" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const db = drizzle(env.DB!, { schema });
    const now = new Date();
    const updated = await db
      .update(tickets)
      .set({ status: "received", updatedAt: now, receivedAt: now })
      .where(and(eq(tickets.id, ticketId), eq(tickets.userId, userId), eq(tickets.status, "pending")))
      .returning()
      .get();

    if (!updated) {
      return new Response(
        JSON.stringify({ error: "Ticket not found or already received" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // Notify the receiver: their ticket list should no longer show this ticket
    try {
      const doId = env.USER_DO.idFromName(userId);
      const stub = env.USER_DO.get(doId);
      await stub.fetch(
        new Request("https://do/broadcast/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        }),
      );
    } catch (broadcastErr) {
      console.warn("[Tickets/receive] DO broadcast to receiver failed:", broadcastErr);
    }

    // Notify the sender (friend transfers only): show a "received" confirmation
    if (updated.fromUserId) {
      try {
        const senderDoId = env.USER_DO.idFromName(updated.fromUserId);
        const senderStub = env.USER_DO.get(senderDoId);
        await senderStub.fetch(
          new Request("https://do/broadcast/transfer_received", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticketId: updated.id,
              filename: updated.filename,
              fileSize: updated.fileSize,
            }),
          }),
        );
      } catch (senderBroadcastErr) {
        // Non-fatal: sender may not be connected
        console.warn("[Tickets/receive] DO broadcast to sender failed:", senderBroadcastErr);
      }
    }

    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Tickets/receive] POST error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to mark ticket received",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

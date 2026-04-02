/**
 * POST /api/tickets/:id/receive
 * Marks a ticket as received (status = "received").
 * Called by the client after it has successfully downloaded the file via the ticket.
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { tickets } from "~/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticateRequest, type Env } from "~/lib/auth";

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

    // Update ticket status — only if it belongs to this user and is still pending
    const updated = await db
      .update(tickets)
      .set({ status: "received", updatedAt: new Date() })
      .where(and(eq(tickets.id, ticketId), eq(tickets.userId, userId)))
      .returning()
      .get();

    if (!updated) {
      return new Response(
        JSON.stringify({ error: "Ticket not found or already received" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // Broadcast updated ticket list to all WS sessions
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
      console.warn("[Tickets/receive] DO broadcast failed:", broadcastErr);
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

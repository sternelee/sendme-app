/**
 * DELETE /api/tickets/:id
 * Deletes a ticket by its ID.
 * Only the ticket owner (userId) or sender (fromUserId) can delete it.
 */

import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { authenticateRequest, getAuthTraceId, type Env } from "~/lib/auth";
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

export async function DELETE(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;
    const traceId = getAuthTraceId(requestEvent.request);
    const { userId, status } = await authenticateRequest(
      requestEvent.request,
      env,
    );

    if (!userId) {
      console.warn(
        `[Tickets/[id]] DELETE auth failed trace=${traceId} status=${status}`,
      );
      return new Response(JSON.stringify({ error: "Unauthorized", status }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ticketId = requestEvent.params.id;
    if (!ticketId) {
      return new Response(JSON.stringify({ error: "Missing ticket ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(
      `[Tickets/[id]] DELETE start trace=${traceId} userId=${userId} ticketId=${ticketId}`,
    );

    const db = drizzle(env.DB!, { schema });

    // Allow deletion by the ticket recipient (userId) OR the sender (fromUserId)
    await db
      .delete(schema.tickets)
      .where(
        and(
          eq(tickets.id, ticketId),
          or(eq(tickets.userId, userId), eq(tickets.fromUserId, userId)),
        ),
      )
      .run();

    console.log(
      `[Tickets/[id]] DELETE success trace=${traceId} userId=${userId} ticketId=${ticketId}`,
    );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Tickets/[id]] DELETE error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to delete ticket",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

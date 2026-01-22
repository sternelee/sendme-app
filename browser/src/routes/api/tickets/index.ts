/**
 * Tickets API Routes
 * Handles sending and receiving tickets between devices
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { devices, tickets } from "~/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { createAuth, type CloudflareBindings } from "~/../better-auth.config";

/**
 * Cloudflare context interface
 */
interface CloudflareContext {
  env: CloudflareBindings;
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
  deviceId: string;
  ticket: string;
  filename?: string;
  fileSize?: number;
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
    const cf = requestEvent.nativeEvent.context.cloudflare.cf;
    const auth = createAuth(env, cf);

    const session = await auth.api.getSession({
      headers: requestEvent.request.headers,
    });

    if (!session) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await requestEvent.request.json() as PostTicketBody;

    if (!body.deviceId || !body.ticket) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: deviceId, ticket" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const db = drizzle(env.DB, { schema });

    // Verify the target device belongs to the user
    const targetDevice = await db.query.devices.findFirst({
      where: (devices, { eq, and }) =>
        and(eq(devices.id, body.deviceId), eq(devices.userId, session.user.id)),
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

    // Create ticket record (expires in 24 hours)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const newTicket = await db
      .insert(schema.tickets)
      .values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        fromDeviceId: body.deviceId,
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
 * Returns tickets sent to this device that haven't been received yet
 */
export async function GET(requestEvent: RequestEvent): Promise<Response> {
  try {
    const env = requestEvent.nativeEvent.context.cloudflare.env;
    const cf = requestEvent.nativeEvent.context.cloudflare.cf;
    const auth = createAuth(env, cf);

    const session = await auth.api.getSession({
      headers: requestEvent.request.headers,
    });

    if (!session) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
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

    const db = drizzle(env.DB, { schema });

    // Get pending tickets for this device
    const pendingTickets = await db.query.tickets.findMany({
      where: (tickets, { eq, and }) =>
        and(
          eq(tickets.fromDeviceId, deviceId),
          eq(tickets.status, "pending"),
          eq(tickets.userId, session.user.id),
        ),
      orderBy: [desc(schema.tickets.createdAt)],
    });

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

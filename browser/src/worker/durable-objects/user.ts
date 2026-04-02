/**
 * User Durable Object
 * Manages WebSocket connections and real-time updates for a user
 * Handles device status changes and incoming tickets
 */

import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/lib/db/schema";
import { devices, tickets } from "~/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { Env } from "~/lib/auth";

type Device = schema.Device;
type Ticket = schema.Ticket;

type WebSocketMessageDevices = { type: "devices"; data: Device[] };
type WebSocketMessageTickets = { type: "tickets"; data: Ticket[] };
type WebSocketMessageDeviceUpdate = { type: "device_update"; data: Partial<Device> & { id: string } };
type WebSocketMessageError = { type: "error"; data: string };
type WebSocketMessagePong = { type: "pong" };

type WebSocketMessage =
  | WebSocketMessageDevices
  | WebSocketMessageTickets
  | WebSocketMessageDeviceUpdate
  | WebSocketMessageError
  | WebSocketMessagePong;

export class UserDO extends DurableObject<Env> {
  private sessions: Map<WebSocket, Set<string>>;
  private deviceSessions: Map<string, Set<WebSocket>>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sessions = new Map();
    this.deviceSessions = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const url = new URL(request.url);
      const userId = url.searchParams.get("userId");
      const deviceId = request.headers.get("X-Device-Id") || url.searchParams.get("deviceId");

      if (!userId) {
        return new Response("User ID required", { status: 400 });
      }

      if (!deviceId) {
        return new Response("Device ID required", { status: 400 });
      }

      return this.handleWebSocket(request, userId, deviceId);
    }

    // Internal broadcast endpoints (called from API routes)
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.endsWith("/broadcast/devices") && request.method === "POST") {
      const { userId } = (await request.json()) as { userId: string };
      await this.sendDevices(userId);
      return new Response("ok");
    }

    if (pathname.endsWith("/broadcast/tickets") && request.method === "POST") {
      const { userId } = (await request.json()) as { userId: string };
      await this.sendTickets(userId);
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleWebSocket(
    _request: Request,
    userId: string,
    deviceId: string,
  ): Promise<Response> {
    const { 0: client, 1: server } = Object.values(new WebSocketPair());

    this.acceptWebSocket(server, userId, deviceId);

    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptWebSocket(ws: WebSocket, userId: string, deviceId: string): void {
    ws.accept();

    // Track session
    if (!this.sessions.has(ws)) {
      this.sessions.set(ws, new Set([deviceId]));
    } else {
      this.sessions.get(ws)?.add(deviceId);
    }

    // Map device to sessions
    if (!this.deviceSessions.has(deviceId)) {
      this.deviceSessions.set(deviceId, new Set([ws]));
    } else {
      this.deviceSessions.get(deviceId)?.add(ws);
    }

    ws.addEventListener("close", () => {
      this.handleDisconnect(ws, deviceId);
    });

    ws.addEventListener("message", (event) => {
      this.handleMessage(ws, userId, deviceId, event.data as string);
    });

    // Send initial state
    this.sendDevices(userId, ws);
    this.sendTickets(userId, ws);
  }

  private handleDisconnect(ws: WebSocket, deviceId: string): void {
    this.sessions.delete(ws);

    const sessions = this.deviceSessions.get(deviceId);
    if (sessions) {
      sessions.delete(ws);
      if (sessions.size === 0) {
        this.deviceSessions.delete(deviceId);
      }
    }
  }

  private async handleMessage(
    ws: WebSocket,
    userId: string,
    deviceId: string,
    data: string,
  ): Promise<void> {
    try {
      const message = JSON.parse(data) as { type: string };

      switch (message.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong" } satisfies WebSocketMessage));
          break;

        case "heartbeat":
          await this.updateHeartbeat(userId, deviceId);
          break;

        default:
          console.log("[UserDO] Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("[UserDO] Message handling error:", error);
      this.sendError(ws, "Invalid message format");
    }
  }

  private async updateHeartbeat(userId: string, deviceId: string): Promise<void> {
    const db = drizzle(this.env.DB, { schema });
    const now = new Date();

    await db
      .update(devices)
      .set({
        online: true,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(devices.userId, userId),
          eq(devices.id, deviceId),
        ),
      );

    // Broadcast updated device list to all sessions for this user
    await this.sendDevices(userId);
  }

  /**
   * Send devices list to a specific WebSocket or broadcast to all user sessions
   */
  async sendDevices(userId: string, ws?: WebSocket): Promise<void> {
    const db = drizzle(this.env.DB, { schema });

    const userDevices = await db
      .select()
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(desc(devices.lastSeenAt));

    const message: WebSocketMessage = {
      type: "devices",
      data: userDevices,
    };

    if (ws) {
      ws.send(JSON.stringify(message));
    } else {
      this.broadcastToUser(message);
    }
  }

  /**
   * Send tickets list to a specific WebSocket or broadcast to all user sessions
   */
  async sendTickets(userId: string, ws?: WebSocket): Promise<void> {
    const db = drizzle(this.env.DB, { schema });

    const userTickets = await db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.userId, userId),
          eq(tickets.status, "pending"),
        ),
      )
      .orderBy(desc(schema.tickets.createdAt));

    const message: WebSocketMessage = {
      type: "tickets",
      data: userTickets,
    };

    if (ws) {
      ws.send(JSON.stringify(message));
    } else {
      this.broadcastToUser(message);
    }
  }

  /**
   * Broadcast message to all WebSocket sessions
   */
  private broadcastToUser(message: WebSocketMessage, excludeDeviceId?: string): void {
    const payload = JSON.stringify(message);

    for (const [ws, deviceIds] of this.sessions.entries()) {
      if (excludeDeviceId && deviceIds.has(excludeDeviceId)) {
        continue;
      }
      try {
        ws.send(payload);
      } catch {
        // Session may have closed; will be cleaned up on close event
      }
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    ws.send(JSON.stringify({ type: "error", data: message } satisfies WebSocketMessage));
  }
}

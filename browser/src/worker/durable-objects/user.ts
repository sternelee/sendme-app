/**
 * User Durable Object
 * Manages WebSocket connections and real-time updates for a user.
 */

import { DurableObject } from "cloudflare:workers";
import { and, desc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "~/lib/auth";
import {
  getOnlineDevices,
  getUserDeviceByPersistentId,
  getUserDevices,
  markDeviceOfflineByPersistentId,
  updateDeviceHeartbeatByPersistentId,
} from "~/lib/api/devices";
import * as schema from "~/lib/db/schema";
import { friends, tickets, users } from "~/lib/db/schema";

type Device = schema.Device;
type Ticket = schema.Ticket;

type WebSocketMessageDevices = { type: "devices"; data: Device[] };
type WebSocketMessageTickets = { type: "tickets"; data: Ticket[] };
type WebSocketMessageFriends = { type: "friends"; data: EnrichedFriend[] };
type WebSocketMessageError = { type: "error"; data: string };
type WebSocketMessagePong = { type: "pong" };
type WebSocketMessageTransferReceived = {
  type: "transfer_received";
  data: { ticketId: string; filename: string | null; fileSize: number | null };
};

interface EnrichedFriend {
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

type WebSocketMessage =
  | WebSocketMessageDevices
  | WebSocketMessageTickets
  | WebSocketMessageFriends
  | WebSocketMessageError
  | WebSocketMessagePong
  | WebSocketMessageTransferReceived;

export class UserDO extends DurableObject<Env> {
  private sessions: Map<WebSocket, string>;
  private deviceSessions: Map<string, Set<WebSocket>>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sessions = new Map();
    this.deviceSessions = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const userId = url.searchParams.get("userId");
      const persistentDeviceId =
        request.headers.get("X-Device-Id") || url.searchParams.get("deviceId");
      const traceId =
        request.headers.get("X-Auth-Trace-Id") ||
        url.searchParams.get("authTraceId") ||
        "none";

      if (!userId) {
        console.warn(`[UserDO] websocket missing userId trace=${traceId}`);
        return new Response("User ID required", { status: 400 });
      }

      if (!persistentDeviceId) {
        console.warn(
          `[UserDO] websocket missing deviceId trace=${traceId} userId=${userId}`,
        );
        return new Response("Device ID required", { status: 400 });
      }

      console.log(
        `[UserDO] websocket fetch trace=${traceId} userId=${userId} deviceId=${persistentDeviceId}`,
      );
      return this.handleWebSocket(userId, persistentDeviceId, traceId);
    }

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

    if (pathname.endsWith("/broadcast/friends") && request.method === "POST") {
      const { userId } = (await request.json()) as { userId: string };
      await this.sendFriends(userId);
      return new Response("ok");
    }

    if (pathname.endsWith("/broadcast/presence") && request.method === "POST") {
      const { userId } = (await request.json()) as { userId: string };
      await this.broadcastPresence(userId);
      return new Response("ok");
    }

    if (
      pathname.endsWith("/broadcast/transfer_received") &&
      request.method === "POST"
    ) {
      const payload = (await request.json()) as {
        ticketId: string;
        filename: string | null;
        fileSize: number | null;
      };
      const message: WebSocketMessageTransferReceived = {
        type: "transfer_received",
        data: payload,
      };
      this.broadcastToAllSockets(message);
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleWebSocket(
    userId: string,
    persistentDeviceId: string,
    traceId: string,
  ): Promise<Response> {
    const { 0: client, 1: server } = Object.values(new WebSocketPair());

    this.acceptWebSocket(server, userId, persistentDeviceId, traceId);

    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptWebSocket(
    ws: WebSocket,
    userId: string,
    persistentDeviceId: string,
    traceId: string,
  ): void {
    ws.accept();
    console.log(
      `[UserDO] websocket accepted trace=${traceId} userId=${userId} deviceId=${persistentDeviceId}`,
    );

    const existingSessions = this.deviceSessions.get(persistentDeviceId);
    const isFirstSessionForDevice =
      !existingSessions || existingSessions.size === 0;

    this.sessions.set(ws, persistentDeviceId);

    if (!existingSessions) {
      this.deviceSessions.set(persistentDeviceId, new Set([ws]));
    } else {
      existingSessions.add(ws);
    }

    ws.addEventListener("close", () => {
      void this.handleDisconnect(ws, userId, persistentDeviceId);
    });

    ws.addEventListener("message", (event) => {
      void this.handleMessage(
        ws,
        userId,
        persistentDeviceId,
        event.data as string,
      );
    });

    void this.sendInitialState(userId, ws);

    if (isFirstSessionForDevice) {
      void this.handleDeviceConnected(userId, persistentDeviceId);
    }
  }

  private async sendInitialState(userId: string, ws: WebSocket): Promise<void> {
    const results = await Promise.allSettled([
      this.sendDevices(userId, ws),
      this.sendTickets(userId, ws),
      this.sendFriends(userId, ws),
    ]);
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[UserDO] sendInitialState [${i}] failed:`, r.reason);
      }
    });
  }

  private async handleDisconnect(
    ws: WebSocket,
    userId: string,
    persistentDeviceId: string,
  ): Promise<void> {
    this.sessions.delete(ws);

    const sessions = this.deviceSessions.get(persistentDeviceId);
    if (!sessions) {
      return;
    }

    sessions.delete(ws);
    if (sessions.size > 0) {
      return;
    }

    this.deviceSessions.delete(persistentDeviceId);

    const db = drizzle(this.env.DB, { schema });
    const markedOffline = await markDeviceOfflineByPersistentId(
      db,
      userId,
      persistentDeviceId,
    );

    if (markedOffline) {
      await this.broadcastPresence(userId);
    }
  }

  private async handleMessage(
    ws: WebSocket,
    userId: string,
    persistentDeviceId: string,
    data: string,
  ): Promise<void> {
    try {
      const message = JSON.parse(data) as { type: string };

      switch (message.type) {
        case "ping":
          this.sendToSocket(ws, { type: "pong" });
          break;
        case "heartbeat":
          await this.updateHeartbeat(userId, persistentDeviceId);
          break;
        default:
          console.log("[UserDO] Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("[UserDO] Message handling error:", error);
      this.sendError(ws, "Invalid message format");
    }
  }

  private async handleDeviceConnected(
    userId: string,
    persistentDeviceId: string,
  ): Promise<void> {
    const db = drizzle(this.env.DB, { schema });
    const updated = await updateDeviceHeartbeatByPersistentId(
      db,
      userId,
      persistentDeviceId,
    );

    if (updated) {
      await this.broadcastPresence(userId);
    }
  }

  private async updateHeartbeat(
    userId: string,
    persistentDeviceId: string,
  ): Promise<void> {
    const db = drizzle(this.env.DB, { schema });
    const updated = await updateDeviceHeartbeatByPersistentId(
      db,
      userId,
      persistentDeviceId,
    );

    if (updated) {
      await this.sendDevices(userId);
    }
  }

  private async broadcastPresence(userId: string): Promise<void> {
    await Promise.all([
      this.sendDevices(userId),
      this.sendFriends(userId),
      this.notifyAcceptedFriends(userId),
    ]);
  }

  private async notifyAcceptedFriends(userId: string): Promise<void> {
    const db = drizzle(this.env.DB, { schema });
    const acceptedFriendships = await db
      .select({ userId: friends.userId, friendUserId: friends.friendUserId })
      .from(friends)
      .where(
        or(
          and(eq(friends.userId, userId), eq(friends.status, "accepted")),
          and(eq(friends.friendUserId, userId), eq(friends.status, "accepted")),
        ),
      );

    const friendIds = [
      ...new Set(
        acceptedFriendships.map((friendship) =>
          friendship.userId === userId
            ? friendship.friendUserId
            : friendship.userId,
        ),
      ),
    ];

    await Promise.all(
      friendIds.map(async (friendId) => {
        try {
          const doId = this.env.USER_DO.idFromName(friendId);
          const stub = this.env.USER_DO.get(doId);
          await stub.fetch(
            new Request("https://do/broadcast/friends", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: friendId }),
            }),
          );
        } catch (error) {
          console.warn("[UserDO] Friend presence broadcast failed:", error);
        }
      }),
    );
  }

  async sendDevices(userId: string, ws?: WebSocket): Promise<void> {
    const db = drizzle(this.env.DB, { schema });
    const userDevices = await getUserDevices(db, userId);

    const message: WebSocketMessage = {
      type: "devices",
      data: userDevices,
    };

    if (ws) {
      this.sendToSocket(ws, message);
      return;
    }

    this.broadcastToAllSockets(message);
  }

  async sendTickets(userId: string, ws?: WebSocket): Promise<void> {
    if (ws) {
      await this.sendTicketsToSocket(userId, ws);
      return;
    }

    await Promise.all(
      [...this.sessions.keys()].map((socket) =>
        this.sendTicketsToSocket(userId, socket),
      ),
    );
  }

  private async sendTicketsToSocket(
    userId: string,
    ws: WebSocket,
  ): Promise<void> {
    const persistentDeviceId = this.sessions.get(ws);
    if (!persistentDeviceId) {
      return;
    }

    const db = drizzle(this.env.DB, { schema });
    const currentDevice = await getUserDeviceByPersistentId(
      db,
      userId,
      persistentDeviceId,
    );

    const userTickets = currentDevice
      ? await db
          .select()
          .from(tickets)
          .where(
            and(
              eq(tickets.userId, userId),
              eq(tickets.status, "pending"),
              gt(tickets.expiresAt, new Date()),
              or(
                eq(tickets.toDeviceId, currentDevice.id),
                and(isNull(tickets.toDeviceId), isNotNull(tickets.toUserId)),
              ),
            ),
          )
          .orderBy(desc(schema.tickets.createdAt))
      : await db
          .select()
          .from(tickets)
          .where(
            and(
              eq(tickets.userId, userId),
              eq(tickets.status, "pending"),
              gt(tickets.expiresAt, new Date()),
              isNull(tickets.toDeviceId),
              isNotNull(tickets.toUserId),
            ),
          )
          .orderBy(desc(schema.tickets.createdAt));

    this.sendToSocket(ws, {
      type: "tickets",
      data: userTickets,
    });
  }

  async sendFriends(userId: string, ws?: WebSocket): Promise<void> {
    if (!this.env.DB) {
      console.error("[UserDO] DB binding missing, cannot send friends");
      return;
    }
    const db = drizzle(this.env.DB, { schema });

    const userFriendships = await db
      .select()
      .from(friends)
      .where(or(eq(friends.userId, userId), eq(friends.friendUserId, userId)))
      .orderBy(desc(friends.updatedAt));

    const enrichedFriends = (
      await Promise.all(
        userFriendships.map(async (friendship) => {
          // Defensive: handle both camelCase and snake_case field names (D1 adapter quirk)
          const getField = (obj: any, camel: string, snake: string): any => {
            if (obj[camel] !== undefined) return obj[camel];
            if (obj[snake] !== undefined) return obj[snake];
            return undefined;
          };

          const fId = getField(friendship, "id", "id");
          const fUserId = getField(friendship, "userId", "user_id");
          const fFriendUserId = getField(
            friendship,
            "friendUserId",
            "friend_user_id",
          );
          const fStatus = getField(friendship, "status", "status");
          const fCreatedAt = getField(friendship, "createdAt", "created_at");
          const fUpdatedAt = getField(friendship, "updatedAt", "updated_at");
          const fAcceptedAt = getField(friendship, "acceptedAt", "accepted_at");

          const friendUserId = fUserId === userId ? fFriendUserId : fUserId;

          if (!friendUserId) {
            return null;
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

          // If friend user record is missing (e.g. Clerk sync failed), use placeholder
          // so the friendship is still visible in the UI.
          const resolvedFriend = friendUser ?? {
            id: friendUserId,
            name: "Unknown User",
            email: "",
            image: null as string | null,
          };

          const friendDevices = friendUser
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

          return {
            id: fId,
            userId: fUserId,
            friendUserId: fFriendUserId,
            status: fStatus as "pending" | "accepted",
            createdAt: fCreatedAt,
            updatedAt: fUpdatedAt,
            acceptedAt: fAcceptedAt,
            friend: resolvedFriend,
            friendDevices,
          } satisfies EnrichedFriend;
        }),
      )
    ).filter((friend): friend is EnrichedFriend => friend !== null);

    const message: WebSocketMessage = {
      type: "friends",
      data: enrichedFriends,
    };

    if (ws) {
      this.sendToSocket(ws, message);
      return;
    }

    this.broadcastToAllSockets(message);
  }

  private broadcastToAllSockets(message: WebSocketMessage): void {
    const payload = JSON.stringify(message);

    for (const ws of this.sessions.keys()) {
      try {
        ws.send(payload);
      } catch {
        // Session may have already closed.
      }
    }
  }

  private sendToSocket(ws: WebSocket, message: WebSocketMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Session may have already closed.
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.sendToSocket(ws, { type: "error", data: message });
  }
}

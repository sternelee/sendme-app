import type { DeviceEntry, PresenceState } from "./types";

export class PresenceDO {
  private state: PresenceState | null = null;
  private wsClients: Map<string, WebSocket> = new Map();
  private heartbeatInterval: number | null = null;

  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/api/presence/friends") {
      return this.handleGetFriendsPresence(request);
    }

    if (url.pathname === "/api/presence/register") {
      return this.handleRegister(request);
    }

    if (url.pathname === "/api/presence/unregister") {
      return this.handleUnregister(request);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async getState(): Promise<PresenceState> {
    if (!this.state) {
      const stored = await this.ctx.storage.get<PresenceState>("state");
      this.state = stored ?? { user_id: "", devices: [], friends: [] };
    }
    return this.state;
  }

  private async saveState(state: PresenceState): Promise<void> {
    this.state = state;
    await this.ctx.storage.put("state", state);
  }

  private async handleGetFriendsPresence(_request: Request): Promise<Response> {
    const state = await this.getState();
    const friendsPresence = await Promise.all(
      state.friends.map(async (friendId) => {
        const id = this.ctx.idFromName(friendId);
        const friendDO = this.ctx.env.PRESENCE.get(id);
        const res = await friendDO.fetch(new Request("http://internal/friends"));
        const data = await res.json<PresenceState>();
        return {
          user_id: friendId,
          devices: data.devices.filter((d) => d.online),
          online: data.devices.some((d) => d.online),
        };
      })
    );

    return Response.json({ friends: friendsPresence });
  }

  private async handleRegister(request: Request): Promise<Response> {
    const { device_id, device_name } = await request.json<{
      device_id: string;
      device_name: string;
    }>();

    const state = await this.getState();
    const existing = state.devices.find((d) => d.device_id === device_id);

    if (existing) {
      existing.online = true;
      existing.last_seen = Date.now();
    } else {
      state.devices.push({
        device_id,
        name: device_name,
        online: true,
        last_seen: Date.now(),
      });
    }

    await this.saveState(state);
    this.broadcastToFriends("friend_online", {
      user_id: state.user_id,
      devices: state.devices.filter((d) => d.online),
    });

    return Response.json({ success: true });
  }

  private async handleUnregister(request: Request): Promise<Response> {
    const { device_id } = await request.json<{ device_id: string }>();

    const state = await this.getState();
    state.devices = state.devices.filter((d) => d.device_id !== device_id);
    await this.saveState(state);

    this.broadcastToFriends("friend_offline", { user_id: state.user_id });

    return Response.json({ success: true });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const userId = request.headers.get("x-user-id");
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    let state = await this.getState();
    if (!state.user_id) {
      state.user_id = userId;
      await this.saveState(state);
    }

    const pair = new WebSocketPair();
    const clientWs = pair.server;
    const clientId = crypto.randomUUID();

    this.ctx.acceptWebSocket(clientWs, { id: clientId });
    this.wsClients.set(clientId, clientWs);

    state.devices.forEach((d) => {
      if (d.ws_client_id === clientId) {
        d.online = true;
        d.last_seen = Date.now();
      }
    });
    await this.saveState(state);

    return new Response(null, { status: 101, webSocket: pair.client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | Buffer
  ): Promise<void> {
    const clientId = this.getClientId(ws);
    if (!clientId) return;

    try {
      const data = JSON.parse(message.toString());

      if (data.type === "register") {
        const state = await this.getState();
        state.devices.forEach((d) => {
          if (d.ws_client_id === clientId) {
            d.device_id = data.device_id;
            d.name = data.device_name;
            d.online = true;
            d.last_seen = Date.now();
          }
        });
        await this.saveState(state);

        this.broadcastToFriends("friend_online", {
          user_id: state.user_id,
          devices: state.devices.filter((d) => d.online),
        });
      }

      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const clientId = this.getClientId(ws);
    if (!clientId) return;

    this.wsClients.delete(clientId);

    const state = await this.getState();
    state.devices.forEach((d) => {
      if (d.ws_client_id === clientId) {
        d.online = false;
        d.last_seen = Date.now();
      }
    });
    await this.saveState(state);

    this.broadcastToFriends("friend_offline", { user_id: state.user_id });
  }

  private getClientId(ws: WebSocket): string | undefined {
    for (const [id, client] of this.wsClients) {
      if (client === ws) return id;
    }
    return undefined;
  }

  private broadcastToFriends(
    type: "friend_online" | "friend_offline",
    payload: { user_id: string; devices?: DeviceEntry[] }
  ): void {
    // Broadcast to all friends that this user is online/offline
    // Implementation depends on friend list stored in state
  }
}

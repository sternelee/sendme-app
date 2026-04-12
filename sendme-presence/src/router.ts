import { Hono } from "hono";
import { verifyClerkToken } from "./auth";
import type { PresenceState, DeviceEntry } from "./types";

interface Env {
  PRESENCE: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/presence/friends", async (c) => {
  const auth = await verifyClerkToken(c.req.raw);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.env.PRESENCE.idFromName(auth.userId);
  const doStub = c.env.PRESENCE.get(id);

  const res = await doStub.fetch(new Request("http://internal/friends"));
  const state = await res.json<PresenceState>();

  const friendsPresence = await Promise.all(
    state.friends.map(async (friendId) => {
      const friendId_doj = c.env.PRESENCE.idFromName(friendId);
      const friendDO = c.env.PRESENCE.get(friendId_doj);
      const fres = await friendDO.fetch(new Request("http://internal/friends"));
      const fstate = await fres.json<PresenceState>();
      return {
        user_id: friendId,
        devices: fstate.devices.filter((d: DeviceEntry) => d.online),
        online: fstate.devices.some((d: DeviceEntry) => d.online),
      };
    })
  );

  return c.json({ friends: friendsPresence });
});

app.post("/api/presence/register", async (c) => {
  const auth = await verifyClerkToken(c.req.raw);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { device_id, device_name } = await c.req.json<{
    device_id: string;
    device_name: string;
  }>();

  const id = c.env.PRESENCE.idFromName(auth.userId);
  const doStub = c.env.PRESENCE.get(id);

  const res = await doStub.fetch("http://internal/register", {
    method: "POST",
    body: JSON.stringify({ device_id, device_name }),
  });

  return c.json(await res.json());
});

app.delete("/api/presence/unregister", async (c) => {
  const auth = await verifyClerkToken(c.req.raw);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { device_id } = await c.req.json<{ device_id: string }>();

  const id = c.env.PRESENCE.idFromName(auth.userId);
  const doStub = c.env.PRESENCE.get(id);

  const res = await doStub.fetch("http://internal/unregister", {
    method: "POST",
    body: JSON.stringify({ device_id }),
  });

  return c.json(await res.json());
});

export { app as router };

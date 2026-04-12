import { verifyClerkToken } from "./auth";
import { router } from "./router";

interface Env {
  PRESENCE: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return handleWebSocket(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return router.fetch(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : url.searchParams.get("token");

  if (!token) {
    return new Response("Missing token", { status: 401 });
  }

  const authRequest = new Request(request, {
    headers: { ...Object.fromEntries(request.headers) },
  });
  const payload = await verifyClerkToken(authRequest);
  if (!payload) {
    return new Response("Invalid token", { status: 401 });
  }

  const userId = payload.userId;
  const id = env.PRESENCE.idFromName(userId);
  const doStub = env.PRESENCE.get(id);

  const wsRequest = new Request(request, {
    headers: { ...Object.fromEntries(request.headers), "x-user-id": userId },
  });

  return doStub.fetch(wsRequest);
}

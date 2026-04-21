/**
 * API Key Single Resource Routes
 * DELETE /api/keys/:id - Revoke an API key
 */

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { apiKeys } from "~/lib/db/schema";
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

/**
 * DELETE /api/keys/:id — Revoke (delete) an API key.
 * Only deletes keys owned by the authenticated user.
 */
export async function DELETE(event: RequestEvent) {
  const env = event.nativeEvent.context.cloudflare.env;
  const { userId } = await authenticateRequest(event.request, env);

  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const keyId = event.params.id;
  if (!keyId) {
    return new Response(JSON.stringify({ error: "Key ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = drizzle(env.DB);
  const result = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

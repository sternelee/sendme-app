/**
 * API Keys Routes
 * GET /api/keys - List user's API keys
 * POST /api/keys - Create a new API key
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { apiKeys } from "~/lib/db/schema";
import { authenticateRequest, sha256hex, type Env } from "~/lib/auth";

interface CloudflareContext {
  env: Env;
}

interface RequestEvent {
  request: Request;
  nativeEvent: {
    context: {
      cloudflare: CloudflareContext;
    };
  };
}

interface CreateKeyBody {
  name: string;
  expiresInDays?: number;
}

/**
 * GET /api/keys — List all API keys for the authenticated user.
 * Returns metadata only (prefix, never the full key).
 */
export async function GET(event: RequestEvent) {
  const env = event.nativeEvent.context.cloudflare.env;
  const { userId } = await authenticateRequest(event.request, env);

  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = drizzle(env.DB);
  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId));

  return new Response(JSON.stringify(keys), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /api/keys — Create a new API key.
 * Only accessible via better-auth session token (not via API key).
 * The full key is returned ONLY in this response.
 */
export async function POST(event: RequestEvent) {
  const env = event.nativeEvent.context.cloudflare.env;
  const { userId, status } = await authenticateRequest(event.request, env);

  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only allow key creation via better-auth session token, not via another API key
  const authHeader = event.request.headers.get("authorization");
  const token = authHeader?.split(" ")[1];
  if (token?.startsWith("sk_")) {
    return new Response(
      JSON.stringify({ error: "API keys cannot create other API keys" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = (await event.request.json()) as CreateKeyBody;
  if (!body.name || typeof body.name !== "string") {
    return new Response(JSON.stringify({ error: "name is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Generate key: sk_ + 32 random hex bytes = 67 chars
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const hex = [...randomBytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const fullKey = `sk_${hex}`;
  const keyHash = await sha256hex(fullKey);
  const keyPrefix = fullKey.slice(0, 11); // "sk_a1b2c3d4"

  const now = new Date();
  const expiresAt = body.expiresInDays
    ? new Date(now.getTime() + body.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const id = crypto.randomUUID();

  const db = drizzle(env.DB);
  await db.insert(apiKeys).values({
    id,
    userId,
    name: body.name,
    keyHash,
    keyPrefix,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  return new Response(
    JSON.stringify({
      id,
      name: body.name,
      key: fullKey,
      keyPrefix,
      expiresAt,
      createdAt: now,
    }),
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    },
  );
}

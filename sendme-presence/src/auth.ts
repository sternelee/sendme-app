import { verifyToken } from "@clerk/backend";

export interface AuthResult {
  userId: string;
  sessionId: string;
}

export async function verifyClerkToken(
  request: Request
): Promise<AuthResult | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token, {
      audience: "sendme-app",
    });

    return {
      userId: payload.sub,
      sessionId: payload.sid ?? "",
    };
  } catch {
    return null;
  }
}

export function requireAuth(result: AuthResult | null): AuthResult {
  if (!result) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return result;
}

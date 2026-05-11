/**
 * Better Auth client for the browser frontend
 */
import { createAuthClient } from "better-auth/solid";

function getBaseURL(): string {
  // Production override via env
  if (import.meta.env.VITE_AUTH_URL) {
    return import.meta.env.VITE_AUTH_URL;
  }
  // Client-side: derive from current origin
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/auth`;
  }
  // SSR fallback for local dev
  return "http://localhost:3000/api/auth";
}

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
});

export type AuthClient = typeof authClient;

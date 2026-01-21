/**
 * Better Auth Client
 * Client-side utilities for authentication
 * Uses better-auth's framework-agnostic client for SolidJS
 */

// @ts-ignore - better-auth/client exports exist but TypeScript has trouble resolving them
import { createAuthClient } from "better-auth/client";

/**
 * Better auth client instance
 */
export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:5173",
});

/**
 * Authentication helper functions
 */
export const { signIn, signUp, signOut, useSession } = authClient;

/**
 * Helper to trigger OAuth sign-in
 */
export function signInWithSocial(provider: "github" | "google") {
  return signIn.social({
    provider,
    callbackURL: "/",
  });
}

/**
 * Helper to sign in with email and password
 */
export function signInWithEmail(email: string, password: string) {
  return signIn.email({
    email,
    password,
    callbackURL: "/",
  });
}

/**
 * Helper to sign up with email and password
 */
export function signUpWithEmail(data: {
  email: string;
  password: string;
  name: string;
}) {
  return signUp.email({
    ...data,
    callbackURL: "/",
  });
}

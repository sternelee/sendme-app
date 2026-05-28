/**
 * Tauri OAuth Bridge Page
 *
 * No UI — automatically initiates the better-auth social sign-in flow
 * and redirects to the OAuth provider (GitHub / Google).
 *
 * Why this page exists:
 * Tauri app's tauriFetch uses an isolated cookie jar. If we call
 * /api/auth/sign-in/social via tauriFetch, better-auth stores the
 * state cookie there, but the system browser (opened later) doesn't
 * have it — causing "State mismatch".
 *
 * By opening this page in the system browser, the entire flow
 * (state cookie → GitHub → callback) happens in the same context.
 */

import { onMount } from "solid-js";
import { useLocation } from "@solidjs/router";

export default function OAuthBridgePage() {
  const location = useLocation();

  onMount(async () => {
    const params = new URLSearchParams(location.search);
    const provider = params.get("provider");
    const mode = params.get("mode");

    if (!provider || (provider !== "github" && provider !== "google")) {
      window.location.href = "/auth/sign-in";
      return;
    }

    const callbackURL =
      mode === "tauri" ? "/auth/callback?mode=tauri" : "/app";

    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          callbackURL,
          disableRedirect: true,
        }),
        redirect: "manual",
        credentials: "include",
      });

      // Server returns 302 redirect to the OAuth provider
      if (response.status === 302 || response.status === 301) {
        const locationHeader = response.headers.get("Location");
        if (locationHeader) {
          window.location.href = locationHeader;
          return;
        }
      }

      // Fallback: if server returns JSON with a URL
      const data = (await response.json().catch(() => null)) as {
        url?: string;
        error?: { message?: string };
      } | null;

      if (data?.url) {
        window.location.href = data.url;
        return;
      }

      console.error("[OAuthBridge] Failed to start OAuth:", data?.error);
      window.location.href = `/auth/sign-in?error=${encodeURIComponent(data?.error?.message || "Failed to start OAuth")}`;
    } catch (error) {
      console.error("[OAuthBridge] OAuth initiation error:", error);
      window.location.href = `/auth/sign-in?error=${encodeURIComponent("Network error")}`;
    }
  });

  return (
    <div class="min-h-screen bg-base-100 flex items-center justify-center">
      <div class="text-center">
        <span class="loading loading-spinner loading-lg text-primary mb-4"></span>
        <p class="text-base-content">Connecting to provider…</p>
      </div>
    </div>
  );
}

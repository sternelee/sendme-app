/**
 * Auth callback page.
 *
 * Two modes:
 * 1. Normal browser OAuth callback — better-auth handles this automatically via
 *    /api/auth/callback/:provider. After OAuth completes the user is redirected
 *    back here (or to the app) with a session cookie set.
 * 2. Tauri deep-link mode (?mode=tauri) — after OAuth completes, this page
 *    reads the better-auth session and deep-links back to the native app with
 *    the bearer token.
 */

import { createEffect, createSignal, onCleanup } from "solid-js";
import { authClient } from "~/lib/auth-client";

export default function AuthCallbackPage() {
  const session = authClient.useSession();
  const url = new URL(window.location.href);
  const isTauriMode = url.searchParams.get("mode") === "tauri";
  const [error, setError] = createSignal<string | null>(null);

  // Safety timeout: if no session after 8s, redirect to sign-in
  const timeoutId = setTimeout(() => {
    const s = session();
    if (!s.data && !isTauriMode) {
      setError("登录失败，请重试。");
      setTimeout(() => {
        window.location.href = "/auth/sign-in";
      }, 2000);
    }
  }, 8000);

  onCleanup(() => clearTimeout(timeoutId));

  createEffect(() => {
    const s = session();
    if (s.isPending) return;

    if (isTauriMode) {
      if (s.data?.user) {
        // Fetch the bearer token from the server (cookie is HttpOnly)
        fetch("/api/auth/token", { credentials: "include" })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            const token = (data as { token?: string } | null)?.token;
            const params = new URLSearchParams();
            if (token) params.set("token", token);
            params.set("user_id", s.data!.user.id);
            params.set("user_email", s.data!.user.email);
            params.set("user_name", s.data!.user.name || s.data!.user.email);
            if (s.data!.user.image) {
              params.set("user_image_url", s.data!.user.image);
            }
            window.location.replace(
              `sendme://auth/callback?${params.toString()}`,
            );
          })
          .catch(() => {
            window.location.replace("sendme://auth/callback");
          });
      } else {
        window.location.replace("sendme://auth/callback");
      }
    } else {
      // Normal browser mode — redirect to app home if logged in,
      // otherwise redirect to sign-in after showing an error briefly
      if (s.data) {
        window.location.href = "/app";
      } else {
        setError("登录失败，请重试。");
        setTimeout(() => {
          window.location.href = "/auth/sign-in";
        }, 2000);
      }
    }
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        height: "100vh",
        "font-family":
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#333",
        "background-color": "#fafafa",
      }}
    >
      {error() ? (
        <>
          <p style={{ "font-size": "16px", margin: "0", color: "#ef4444" }}>
            {error()}
          </p>
          <p style={{ "font-size": "13px", color: "#999", "margin-top": "8px" }}>
            Redirecting to sign-in…
          </p>
        </>
      ) : (
        <>
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "3px solid #e0e0e0",
              "border-top-color": "#666",
              "border-radius": "50%",
              animation: "spin 0.8s linear infinite",
              "margin-bottom": "20px",
            }}
          />
          <p style={{ "font-size": "16px", margin: "0" }}>
            {isTauriMode ? "正在完成登录，即将返回应用…" : "正在登录…"}
          </p>
          <p style={{ "font-size": "13px", color: "#999", "margin-top": "8px" }}>
            {isTauriMode
              ? "Completing sign-in, redirecting back to the app…"
              : "Signing you in…"}
          </p>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

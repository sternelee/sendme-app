import { createEffect } from "solid-js";
import { useAuth, useUser } from "clerk-solidjs";

export default function AuthCallbackPage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  let handled = false;

  const parseJwtPayload = (token: string): Record<string, unknown> | null => {
    try {
      const [, payload] = token.split(".");
      if (!payload) return null;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  };

  createEffect(() => {
    if (handled) return;
    if (!isLoaded()) return;

    if (isSignedIn()) {
      handled = true;
      getToken()
        .then((token) => {
          const params = new URLSearchParams();
          if (token) {
            params.set("__clerk_token", token);
            const payload = parseJwtPayload(token);
            const sessionId =
              typeof payload?.sid === "string" ? payload.sid : null;
            const issuedAt =
              typeof payload?.iat === "number" ? String(payload.iat) : null;
            const expiresAt =
              typeof payload?.exp === "number" ? String(payload.exp) : null;

            if (sessionId) {
              params.set("session_id", sessionId);
            }
            if (issuedAt) {
              params.set("token_iat", issuedAt);
            }
            if (expiresAt) {
              params.set("token_exp", expiresAt);
            }
          }
          if (user()) {
            params.set("user_id", user()!.id);

            const primaryEmail =
              user()!.primaryEmailAddress?.emailAddress ||
              user()!.emailAddresses[0]?.emailAddress;
            if (primaryEmail) {
              params.set("user_email", primaryEmail);
            }

            const displayName =
              user()!.fullName || user()!.username || user()!.firstName || "";
            if (displayName) {
              params.set("user_name", displayName);
            }

            if (user()!.imageUrl) {
              params.set("user_image_url", user()!.imageUrl);
            }
          }
          // Also pass the dev-browser token so the native client can
          // identify the same Clerk browser session.
          const dbJwt = document.cookie
            .split("; ")
            .find((row) => row.startsWith("__clerk_db_jwt="))
            ?.split("=")[1];
          if (dbJwt) {
            params.set("__clerk_db_jwt", dbJwt);
          }
          window.location.replace(
            `sendme://auth/callback?${params.toString()}`,
          );
        })
        .catch(() => {
          window.location.replace("sendme://auth/callback");
        });
    } else {
      handled = true;
      window.location.replace("sendme://auth/callback");
    }
  });

  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      height: "100vh",
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#333",
      "background-color": "#fafafa",
    }}>
      <div style={{
        width: "40px",
        height: "40px",
        border: "3px solid #e0e0e0",
        "border-top-color": "#666",
        "border-radius": "50%",
        animation: "spin 0.8s linear infinite",
        "margin-bottom": "20px",
      }} />
      <p style={{ "font-size": "16px", margin: "0" }}>
        正在完成登录，即将返回应用…
      </p>
      <p style={{ "font-size": "13px", color: "#999", "margin-top": "8px" }}>
        Completing sign-in, redirecting back to the app…
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

import { createEffect } from "solid-js";
import { useAuth } from "clerk-solidjs";

export default function AuthCallbackPage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  let handled = false;

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

  return null;
}

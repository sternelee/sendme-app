/**
 * Clerk Auth for Tauri Desktop App
 * Uses tauri-plugin-clerk for native Tauri authentication
 */

import { Clerk } from "@clerk/clerk-js";
import { initClerk } from "tauri-plugin-clerk";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getCloudApiOrigin } from "./cloud-api";
import {
  createContext,
  useContext,
  createSignal,
  onCleanup,
  onMount,
  JSX,
} from "solid-js";

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  imageUrl?: string;
}

interface AuthContextValue {
  user: () => UserInfo | null;
  isLoaded: () => boolean;
  isSignedIn: () => boolean;
  signIn: () => Promise<void>;
  signUp: () => Promise<void>;
  signOut: () => Promise<void>;
  clerk: () => Clerk | null;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>();

const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "pk_test_placeholder";
const AUTH_STARTUP_TIMEOUT_MS = 2200;

const getAuthRedirectUrl = () => `${getCloudApiOrigin()}/auth/callback`;

/**
 * Auth Provider for Tauri Desktop App
 */
export function AuthProvider(props: { children: JSX.Element }) {
  const [user, setUser] = createSignal<UserInfo | null>(null);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [isSignedIn, setIsSignedIn] = createSignal(false);
  const [clerkInstance, setClerkInstance] = createSignal<Clerk | null>(null);

  onMount(async () => {
    const fallbackTimer = window.setTimeout(() => {
      setIsLoaded(true);
    }, AUTH_STARTUP_TIMEOUT_MS);

    let clerkUnsubscribe: (() => void) | undefined;
    let tauriUnlisten: (() => void) | undefined;
    let deepLinkUnlisten: (() => void) | undefined;
    let callbackUnlisten: (() => void) | undefined;

    onCleanup(() => {
      window.clearTimeout(fallbackTimer);
      clerkUnsubscribe?.();
      tauriUnlisten?.();
      deepLinkUnlisten?.();
      callbackUnlisten?.();
    });

    try {
      // Initialize clerk using tauri-plugin-clerk
      // initClerk returns a Promise<Clerk> that resolves when clerk is ready
      const clerk = await initClerk({
        publishableKey: CLERK_PUBLISHABLE_KEY,
      });
      setClerkInstance(clerk);

      const syncFromClerk = () => {
        if (clerk.user) {
          setIsSignedIn(true);
          setUser({
            id: clerk.user.id,
            email: clerk.user.emailAddresses[0]?.emailAddress || "",
            name: clerk.user.fullName || clerk.user.username || "",
            imageUrl: clerk.user.imageUrl,
          });
        } else {
          setUser(null);
          setIsSignedIn(false);
        }
      };

      // Check initial sign-in status
      syncFromClerk();
      setIsLoaded(true);

      // Listen for session changes directly from Clerk JS
      clerkUnsubscribe = clerk.addListener(({ user: clerkUser }) => {
        if (clerkUser) {
          setUser({
            id: clerkUser.id,
            email: clerkUser.emailAddresses[0]?.emailAddress || "",
            name: clerkUser.fullName || clerkUser.username || "",
            imageUrl: clerkUser.imageUrl,
          });
          setIsSignedIn(true);
        } else {
          setUser(null);
          setIsSignedIn(false);
        }
      });

      // Fallback: listen to Tauri auth events from Rust and re-sync
      tauriUnlisten = await listen("plugin-clerk-auth-cb", () => {
        syncFromClerk();
      });

      // Listen for Rust to finish processing the browser auth deep link,
      // then force Clerk JS to reload its initial resources so the new session is picked up.
      callbackUnlisten = await listen("clerk-auth-callback-complete", async () => {
        console.log("[auth] Clerk auth callback complete, reloading resources");
        try {
          // Fetch the latest client/environment from Rust so we can inject the new
          // session directly into the JS Clerk instance (bypassing the stale cache).
          const fresh = await invoke<{
            client: any;
            environment: any;
            publishableKey: string;
          }>("plugin:clerk|initialize");
          console.log(
            "[auth] Re-initialized clerk, sessions:",
            fresh.client?.sessions?.length,
            "lastActiveSessionId:",
            fresh.client?.last_active_session_id,
          );

          // Replace the cached resources so reloadInitialResources picks up the new session
          (clerk as any).__internal_getCachedResources = async () => ({
            client: fresh.client,
            environment: fresh.environment,
          });

          // Guard against a hanging reload by enforcing a 2-second timeout.
          await Promise.race([
            (clerk as any).__internal_reloadInitialResources?.(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("reload timeout")), 2000),
            ),
          ]);
          syncFromClerk();
        } catch (err: unknown) {
          console.error("[auth] Failed to reload Clerk resources:", err);
          // Fallback: hard reload the page so Clerk re-initializes from Rust cache.
          window.location.reload();
        }
      });

      // Listen for deep link callbacks from system browser auth
      try {
        deepLinkUnlisten = await onOpenUrl((urls) => {
          for (const url of urls) {
            if (url.startsWith("sendme://auth/callback")) {
              // The actual state reload is triggered by the clerk-auth-callback-complete event
              // from Rust once the handshake finishes; this listener just ensures the app wakes up.
              console.log("[auth] Received auth deep link:", url);
            }
          }
        });
      } catch (e) {
        console.error("Failed to register deep link listener:", e);
      }
    } catch (error) {
      console.error("Failed to initialize Clerk:", error);
      setIsLoaded(true);
    } finally {
      window.clearTimeout(fallbackTimer);
    }
  });

  const getClerkHostedBaseUrl = (clerk: Clerk): string => {
    const frontendApi = (clerk as any).frontendApi;
    if (frontendApi && typeof frontendApi === "string") {
      return `https://${frontendApi}`;
    }
    return `https://${(clerk as any).environment?.displayConfig?.frontendApi || ""}`;
  };

  const getClerkSignInUrl = (clerk: Clerk): string => {
    const redirectUrl = getAuthRedirectUrl();
    let url = clerk.buildSignInUrl?.({
      redirectUrl,
    });
    console.log("[auth] clerk.buildSignInUrl returned:", url);

    // In standardBrowser:false mode buildSignInUrl may return the app's configured
    // signInUrl (e.g. https://sendme.leeapp.dev/) which is wrong for system-browser auth,
    // or it may return Clerk's hosted URL without the redirect_url query param.
    // Ensure we always end up with a Clerk-hosted URL that includes our redirect_url.
    if (!url || !url.startsWith("http") || url.startsWith(getCloudApiOrigin())) {
      const base = getClerkHostedBaseUrl(clerk);
      url = `${base}/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`;
      console.log("[auth] Falling back to hosted sign-in URL:", url);
    } else if (!url.includes("redirect_url=")) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}redirect_url=${encodeURIComponent(redirectUrl)}`;
      console.log("[auth] Appended redirect_url to sign-in URL:", url);
    }
    return url;
  };

  const getClerkSignUpUrl = (clerk: Clerk): string => {
    const redirectUrl = getAuthRedirectUrl();
    let url = clerk.buildSignUpUrl?.({
      redirectUrl,
    });
    if (!url || !url.startsWith("http") || url.startsWith(getCloudApiOrigin())) {
      const base = getClerkHostedBaseUrl(clerk);
      url = `${base}/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`;
    } else if (!url.includes("redirect_url=")) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}redirect_url=${encodeURIComponent(redirectUrl)}`;
    }
    return url;
  };

  const signIn = async () => {
    const clerk = clerkInstance();
    if (clerk) {
      const url = getClerkSignInUrl(clerk);
      console.log("[auth] Opening sign-in URL:", url);
      await invoke("open_system_browser", { url });
    }
  };

  const signUp = async () => {
    const clerk = clerkInstance();
    if (clerk) {
      const url = getClerkSignUpUrl(clerk);
      console.log("[auth] Opening sign-up URL:", url);
      await invoke("open_system_browser", { url });
    }
  };

  const signOut = async () => {
    const clerk = clerkInstance();
    if (clerk) {
      await clerk.signOut();
      setUser(null);
      setIsSignedIn(false);
    }
  };

  const getToken = async (): Promise<string | null> => {
    try {
      // Use tauri-plugin-clerk to get the JWT token
      const token = await invoke<string | null>(
        "plugin:clerk|get_client_authorization_header",
      );
      return token;
    } catch (error) {
      console.error("Failed to get token:", error);
      return null;
    }
  };

  const value: AuthContextValue = {
    user,
    isLoaded,
    isSignedIn,
    signIn,
    signUp,
    signOut,
    clerk: clerkInstance,
    getToken,
  };

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

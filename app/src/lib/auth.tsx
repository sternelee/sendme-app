/**
 * Clerk Auth for Tauri Desktop App
 * Uses tauri-plugin-clerk for native Tauri authentication.
 *
 * Key design decisions:
 * 1. User info is cached in localStorage so restarts show the user instantly.
 * 2. Clerk JS init runs in the background — the UI never blocks on it.
 * 3. Events from Rust (plugin-clerk-auth-cb, clerk-auth-callback-complete)
 *    update the cached user and signals without depending on Clerk JS state.
 */

import { Clerk } from "@clerk/clerk-js";
import { initClerk } from "tauri-plugin-clerk";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getCloudApiOrigin } from "./cloud-api";
import { normalizeAuthorizationHeader } from "./cloud-api";
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

const USER_CACHE_KEY = "sendme_cached_user";

const getAuthRedirectUrl = () => `${getCloudApiOrigin()}/auth/callback`;

// ── localStorage helpers ──

function loadCachedUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string") return parsed as UserInfo;
  } catch { /* ignore */ }
  return null;
}

function saveCachedUser(u: UserInfo | null) {
  try {
    if (u) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u));
    } else {
      localStorage.removeItem(USER_CACHE_KEY);
    }
  } catch { /* ignore */ }
}

// ── Rust event types ──

interface RustUser {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  image_url?: string | null;
  email_addresses?: Array<{ email_address: string }>;
}
interface PublicUserData {
  user_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  identifier?: string | null;
}
interface RustSession {
  user?: RustUser | null;
  public_user_data?: PublicUserData | null;
  last_active_token?: { object: string; jwt: string } | null;
}
interface ClerkAuthEventData {
  source: string;
  payload: {
    user: RustUser | null;
    session?: RustSession | null;
    client?: { sessions?: RustSession[] } | null;
  };
}

function rustUserToUserInfo(ru: RustUser): UserInfo {
  return {
    id: ru.id,
    email: ru.email_addresses?.[0]?.email_address || "",
    name:
      [ru.first_name, ru.last_name].filter(Boolean).join(" ") ||
      ru.username ||
      "",
    imageUrl: ru.image_url || undefined,
  };
}

function userFromPublicData(data: PublicUserData): RustUser | null {
  if (!data.user_id && !data.identifier) return null;
  return {
    id: data.user_id || "unknown",
    first_name: data.first_name,
    last_name: data.last_name,
    image_url: data.image_url,
    email_addresses: data.identifier
      ? [{ email_address: data.identifier }]
      : [],
  };
}

function extractUserFromPayload(
  payload: ClerkAuthEventData["payload"],
): RustUser | null {
  if (payload.user) return payload.user;
  if (payload.session?.public_user_data) {
    const u = userFromPublicData(payload.session.public_user_data);
    if (u) return u;
  }
  const sessions = payload.client?.sessions;
  if (sessions && sessions.length > 0) {
    if (sessions[0].user) return sessions[0].user;
    if (sessions[0].public_user_data) {
      const u = userFromPublicData(sessions[0].public_user_data);
      if (u) return u;
    }
  }
  return null;
}

function extractUserFromDeepLink(url: string): UserInfo | null {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("user_id");
    if (!id) return null;
    return {
      id,
      email: parsed.searchParams.get("user_email") || "",
      name: parsed.searchParams.get("user_name") || "",
      imageUrl: parsed.searchParams.get("user_image_url") || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Auth Provider for Tauri Desktop App
 */
export function AuthProvider(props: { children: JSX.Element }) {
  // Restore cached user synchronously — no async, no flicker
  const cached = loadCachedUser();
  const [user, _setUser] = createSignal<UserInfo | null>(cached);
  const [isLoaded, setIsLoaded] = createSignal(true); // always loaded immediately
  const [isSignedIn, setIsSignedIn] = createSignal(!!cached);
  const [clerkInstance, setClerkInstance] = createSignal<Clerk | null>(null);

  // Wrapper that also persists to localStorage
  const setUser = (u: UserInfo | null) => {
    _setUser(u);
    setIsSignedIn(!!u);
    saveCachedUser(u);
  };

  onMount(() => {
    let clerkUnsubscribe: (() => void) | undefined;
    let tauriUnlisten: (() => void) | undefined;
    let deepLinkUnlisten: (() => void) | undefined;
    let callbackUnlisten: (() => void) | undefined;

    onCleanup(() => {
      clerkUnsubscribe?.();
      tauriUnlisten?.();
      deepLinkUnlisten?.();
      callbackUnlisten?.();
    });

    // Helper: update from Clerk JS user object (only if it has data)
    const syncFromClerk = (clerk: Clerk) => {
      if (clerk.user) {
        setUser({
          id: clerk.user.id,
          email: clerk.user.emailAddresses[0]?.emailAddress || "",
          name: clerk.user.fullName || clerk.user.username || "",
          imageUrl: clerk.user.imageUrl,
        });
      }
      // NOTE: intentionally do NOT clear user when clerk.user is null —
      // the Rust side is the source of truth; Clerk JS in standardBrowser:false
      // often reports null even when a valid session exists.
    };

    // ── 1. Start Clerk JS init in background (fire-and-forget) ──
    const initClerkBackground = async () => {
      try {
        const clerk = await initClerk();
        setClerkInstance(clerk);
        console.log("[auth] Clerk JS initialized, user=", clerk.user?.id ?? null);

        syncFromClerk(clerk);

        clerkUnsubscribe = clerk.addListener(({ user: clerkUser }) => {
          if (clerkUser) {
            setUser({
              id: clerkUser.id,
              email: clerkUser.emailAddresses[0]?.emailAddress || "",
              name: clerkUser.fullName || clerkUser.username || "",
              imageUrl: clerkUser.imageUrl,
            });
          }
          // Don't clear on null — Rust events are authoritative
        });
      } catch (error) {
        console.error("[auth] Failed to initialize Clerk JS (non-blocking):", error);
      }
    };

    // Don't await — this runs in the background
    initClerkBackground();

    // ── 2. Listen for Rust auth events (these work even before Clerk JS is ready) ──

    const setupTauriListeners = async () => {
      tauriUnlisten = await listen<ClerkAuthEventData>("plugin-clerk-auth-cb", async (event) => {
        const p = event.payload.payload;
        console.log("[auth] plugin-clerk-auth-cb:", {
          hasUser: !!p.user,
          sessionCount: p.client?.sessions?.length,
        });

        const extracted = extractUserFromPayload(p);
        if (extracted) {
          console.log("[auth] plugin-clerk-auth-cb: user found →", extracted.id);
          setUser(rustUserToUserInfo(extracted));
        }
        // If no user in payload, do nothing — keep whatever we have cached
      });

      callbackUnlisten = await listen<{
        success: boolean;
        user: RustUser | null;
      }>("clerk-auth-callback-complete", (event) => {
        const payload = event.payload;
        console.log("[auth] clerk-auth-callback-complete, success=", payload.success);
        if (payload.user) {
          console.log("[auth] callback-complete: user →", payload.user.id);
          setUser(rustUserToUserInfo(payload.user));
          return;
        }
        // If no user in event but we already have one cached, keep it.
        if (user()) {
          console.log("[auth] callback-complete: no user in payload, keeping cached user");
          return;
        }
        // Last resort: try to reload from Clerk JS
        const clerk = clerkInstance();
        if (clerk) {
          console.log("[auth] callback-complete: attempting Clerk JS sync");
          syncFromClerk(clerk);
        }
      });

      // Deep link listener
      try {
        deepLinkUnlisten = await onOpenUrl(async (urls) => {
          for (const url of urls) {
            if (url.startsWith("sendme://auth/callback")) {
              console.log("[auth] Received auth deep link:", url);

              const parsed = new URL(url);
              const clerkToken = parsed.searchParams.get("__clerk_token");
              const sessionId = parsed.searchParams.get("session_id");

              if (clerkToken) {
                console.log("[auth] Saving cloud token from deep link");
                const header = normalizeAuthorizationHeader(clerkToken);
                if (!header) {
                  continue;
                }
                await invoke("set_cloud_authorization_header", {
                  header,
                }).catch((e) =>
                  console.error("[auth] Failed to save cloud token:", e)
                );
              }

              const deepLinkUser = extractUserFromDeepLink(url);
              if (deepLinkUser) {
                console.log("[auth] Deep link user:", deepLinkUser.id);
                setUser(deepLinkUser);
              }

              // If Clerk JS is ready, trigger it to reload session from the token
              const clerk = clerkInstance();
              if (clerk) {
                // Clerk JS needs the session to be created from the token
                // In standardBrowser:false, we need to call setActive with the session
                if (sessionId) {
                  console.log("[auth] Triggering Clerk JS setActive for session:", sessionId);
                  clerk
                    .setActive({ session: sessionId })
                    .then(() => console.log("[auth] Clerk JS session activated"))
                    .catch((e) => console.error("[auth] setActive failed:", e));
                } else if (clerkToken) {
                  // No sessionId but have token - try to reload Clerk
                  console.log("[auth] No sessionId, reloading Clerk to pick up token");
                  await clerk.reload();
                }
              }
            }
          }
        });
      } catch (e) {
        console.error("[auth] Failed to register deep link listener:", e);
      }
    };

    setupTauriListeners();
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
      try { await clerk.signOut(); } catch (e) { console.error("[auth] clerk.signOut error:", e); }
    }
    await invoke("clear_cloud_authorization_header").catch((e) =>
      console.error("[auth] Failed to clear cloud token:", e)
    );
    setUser(null);
  };

  const getToken = async (): Promise<string | null> => {
    try {
      const token = await invoke<string | null>("get_cloud_authorization_header");
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

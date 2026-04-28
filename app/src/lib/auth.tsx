/**
 * Clerk auth bridge for the Tauri app.
 *
 * Browser is the source of truth for login completion:
 * - user signs in via Clerk hosted pages in the system browser
 * - browser /auth/callback resolves Clerk session -> `__clerk_token`
 * - deep link returns that verified session JWT to the app
 * - app persists the exact same bearer token used by browser API auth
 *
 * We still initialize tauri-plugin-clerk in the background so the native app can
 * restore user/session details and attempt refreshes, but cloud API auth no
 * longer depends on Clerk JS successfully materializing a native session first.
 */

import { Clerk } from "@clerk/clerk-js";
import { initClerk } from "tauri-plugin-clerk";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  createContext,
  useContext,
  createSignal,
  onCleanup,
  onMount,
  JSX,
} from "solid-js";
import { getCloudApiOrigin, initCloudApi } from "./cloud-api";
import {
  CachedAuthSession,
  clearCachedAuthState,
  createCachedAuthSession,
  extractAuthCallbackData,
  hasUsableCachedAuthSession,
  loadCachedAuthSession,
  loadCachedDevBrowserToken,
  loadCachedUser,
  saveCachedAuthSession,
  saveCachedDevBrowserToken,
  saveCachedUser,
  UserInfo,
} from "./auth-session";
import { debugError, debugInfo, debugWarn } from "./debug-log";

interface AuthContextValue {
  user: () => UserInfo | null;
  isLoaded: () => boolean;
  isSignedIn: () => boolean;
  isCloudReady: () => boolean;
  signIn: () => Promise<void>;
  signUp: () => Promise<void>;
  signOut: () => Promise<void>;
  clerk: () => Clerk | null;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>();

const getAuthRedirectUrl = () => `${getCloudApiOrigin()}/auth/callback`;

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

interface CallbackCompletePayload {
  success: boolean;
  user: UserInfo | null;
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
    const user = userFromPublicData(payload.session.public_user_data);
    if (user) return user;
  }

  const firstSession = payload.client?.sessions?.[0];
  if (!firstSession) return null;
  if (firstSession.user) return firstSession.user;
  if (firstSession.public_user_data) {
    return userFromPublicData(firstSession.public_user_data);
  }
  return null;
}

function extractSessionFromPayload(
  payload: ClerkAuthEventData["payload"],
): CachedAuthSession | null {
  const token =
    payload.session?.last_active_token?.jwt ||
    payload.client?.sessions?.find((session) => session.last_active_token?.jwt)
      ?.last_active_token?.jwt;

  return token ? createCachedAuthSession(token) : null;
}

async function syncClerkDevBrowserToken(token: string | null): Promise<void> {
  try {
    await invoke("set_clerk_dev_browser_token", { token });
  } catch (error) {
    debugError("auth", "Failed to sync Clerk dev browser token", error);
  }
}

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return await Promise.race([
    task,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

export function AuthProvider(props: { children: JSX.Element }) {
  const cachedSession = loadCachedAuthSession();
  const persistedUser = loadCachedUser();
  const initialSession = hasUsableCachedAuthSession(cachedSession)
    ? cachedSession
    : null;
  const initialUser = persistedUser;

  const [user, setUserSignal] = createSignal<UserInfo | null>(initialUser);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [isSignedIn, setIsSignedIn] = createSignal(!!initialSession);
  const [isCloudReady, setIsCloudReady] = createSignal(false);
  const [clerkInstance, setClerkInstance] = createSignal<Clerk | null>(null);
  const [session, setSessionSignal] = createSignal<CachedAuthSession | null>(
    initialSession,
  );

  const setUser = (nextUser: UserInfo | null) => {
    setUserSignal(nextUser);
    saveCachedUser(nextUser);
  };

  const clearAuthState = () => {
    clearCachedAuthState();
    setUserSignal(null);
    setSessionSignal(null);
    setIsSignedIn(false);
    setIsCloudReady(false);
  };

  const applySession = async (
    nextSession: CachedAuthSession | null,
    nextUser?: UserInfo | null,
  ) => {
    const usableSession = hasUsableCachedAuthSession(nextSession)
      ? nextSession
      : null;
    setSessionSignal(usableSession);
    saveCachedAuthSession(usableSession);
    setIsSignedIn(!!usableSession);

    if (nextUser !== undefined) {
      setUser(nextUser);
    } else if (!usableSession) {
      setUser(null);
    }
  };

  const handleDeepLinkCallback = async (url: string) => {
    setIsCloudReady(false);
    const { session: callbackSession, user: callbackUser } =
      extractAuthCallbackData(url);

    const parsed = new URL(url);
    const devBrowserToken =
      parsed.searchParams.get("__clerk_db_jwt")?.trim() || null;
    if (devBrowserToken) {
      saveCachedDevBrowserToken(devBrowserToken);
      await syncClerkDevBrowserToken(devBrowserToken);
    }

    if (callbackUser) {
      setUser(callbackUser);
    }

    if (callbackSession) {
      await applySession(callbackSession, callbackUser ?? user());
    }

    const sessionId = parsed.searchParams.get("session_id");
    const clerk = clerkInstance();
    if (!clerk) {
      return;
    }

    if (sessionId) {
      clerk
        .setActive({ session: sessionId })
        .then(() =>
          debugInfo("auth", "Clerk JS session activated from deep link"),
        )
        .catch((error) => debugError("auth", "Clerk setActive failed", error));
      return;
    }

    if (callbackSession?.token) {
      clerk
        .reload()
        .then(() => debugInfo("auth", "Clerk JS reloaded after deep link"))
        .catch((error) => debugError("auth", "Clerk reload failed", error));
    }
  };

  onMount(() => {
    let clerkUnsubscribe: (() => void) | undefined;
    let rustEventUnlisten: (() => void) | undefined;
    let callbackUnlisten: (() => void) | undefined;
    let deepLinkUnlisten: (() => void) | undefined;
    let disposed = false;

    const syncUserFromClerk = (instance: Clerk) => {
      if (!instance.user || disposed) return;
      setUser({
        id: instance.user.id,
        email: instance.user.emailAddresses[0]?.emailAddress || "",
        name: instance.user.fullName || instance.user.username || "",
        imageUrl: instance.user.imageUrl,
      });
    };

    const runBackgroundRecovery = async () => {
      const cachedDevBrowserToken = loadCachedDevBrowserToken();
      if (cachedDevBrowserToken) {
        debugInfo("auth", "Startup restoring cached Clerk dev browser token");
        await syncClerkDevBrowserToken(cachedDevBrowserToken);
      }

      if (session()) {
        debugInfo("auth", "Startup using cached usable session");
      } else if (persistedUser) {
        debugInfo(
          "auth",
          `Startup found cached user without usable local session: ${persistedUser.id}`,
        );
      }

      const sessionIdHint = session()?.sessionId ?? cachedSession?.sessionId;

      try {
        const clerk = await withTimeout(initClerk(), 8000, "initClerk");
        if (disposed) return;
        setClerkInstance(clerk);
        syncUserFromClerk(clerk);

        // Wire cloud-api token source to Clerk JS immediately
        initCloudApi(getToken);

        if (!clerk.user && sessionIdHint) {
          debugInfo(
            "auth",
            `Clerk startup missing active user; trying setActive with cached sessionId=${sessionIdHint}`,
          );
          try {
            await withTimeout(
              clerk.setActive({ session: sessionIdHint }),
              5000,
              "clerk.setActive(startup)",
            );
            debugInfo("auth", "Clerk startup setActive succeeded");
            syncUserFromClerk(clerk);
          } catch (error) {
            debugWarn("auth", "Clerk startup setActive failed", error);
            try {
              await withTimeout(clerk.reload(), 5000, "clerk.reload(startup)");
              debugInfo(
                "auth",
                "Clerk startup reload succeeded after setActive failure",
              );
              syncUserFromClerk(clerk);
            } catch (reloadError) {
              debugWarn("auth", "Clerk startup reload failed", reloadError);
            }
          }
        }

        if (!clerkUnsubscribe) {
          clerkUnsubscribe = clerk.addListener(({ user: clerkUser }) => {
            if (!clerkUser || disposed) return;
            setUser({
              id: clerkUser.id,
              email: clerkUser.emailAddresses[0]?.emailAddress || "",
              name: clerkUser.fullName || clerkUser.username || "",
              imageUrl: clerkUser.imageUrl,
            });
          });
        }
      } catch (error) {
        debugError("auth", "Failed to initialize Clerk JS", error);
      } finally {
        if (!disposed) {
          setIsCloudReady(true);
        }
      }
    };

    const bootstrap = async () => {
      try {
        rustEventUnlisten = await listen<ClerkAuthEventData>(
          "plugin-clerk-auth-cb",
          async (event) => {
            if (event.payload.source !== "rust" || disposed) {
              return;
            }

            const payload = event.payload.payload;
            const rustUser = extractUserFromPayload(payload);
            const rustSession = extractSessionFromPayload(payload);

            if (rustUser) {
              setUser(rustUserToUserInfo(rustUser));
            }

            if (rustSession) {
              await applySession(
                rustSession,
                rustUser ? rustUserToUserInfo(rustUser) : user(),
              );
            }
          },
        );

        callbackUnlisten = await listen<CallbackCompletePayload>(
          "clerk-auth-callback-complete",
          async (event) => {
            if (disposed) return;
            const payload = event.payload;
            if (payload.user) {
              setUser(payload.user);
            }

            if (!payload.success && !session()) {
              await applySession(null, null);
            }
            setIsCloudReady(true);
          },
        );

        deepLinkUnlisten = await onOpenUrl(async (urls) => {
          for (const url of urls) {
            if (disposed) return;
            if (url.startsWith("sendme://auth/callback")) {
              await handleDeepLinkCallback(url);
            }
          }
        });
      } catch (error) {
        debugError("auth", "Failed to register auth listeners", error);
      }

      setIsLoaded(true);
      debugInfo(
        "auth",
        "Auth provider marked loaded; startup recovery continues in background",
      );
      void runBackgroundRecovery();
    };

    void bootstrap();

    onCleanup(() => {
      disposed = true;
      clerkUnsubscribe?.();
      rustEventUnlisten?.();
      callbackUnlisten?.();
      deepLinkUnlisten?.();
    });
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
    let url = clerk.buildSignInUrl?.({ redirectUrl });

    if (
      !url ||
      !url.startsWith("http") ||
      url.startsWith(getCloudApiOrigin())
    ) {
      const base = getClerkHostedBaseUrl(clerk);
      url = `${base}/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`;
    } else if (!url.includes("redirect_url=")) {
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}redirect_url=${encodeURIComponent(redirectUrl)}`;
    }

    return url;
  };

  const getClerkSignUpUrl = (clerk: Clerk): string => {
    const redirectUrl = getAuthRedirectUrl();
    let url = clerk.buildSignUpUrl?.({ redirectUrl });

    if (
      !url ||
      !url.startsWith("http") ||
      url.startsWith(getCloudApiOrigin())
    ) {
      const base = getClerkHostedBaseUrl(clerk);
      url = `${base}/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`;
    } else if (!url.includes("redirect_url=")) {
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}redirect_url=${encodeURIComponent(redirectUrl)}`;
    }

    return url;
  };

  const openClerkUrl = async (builder: (clerk: Clerk) => string) => {
    const clerk = clerkInstance();
    if (!clerk) {
      throw new Error("Clerk is still initializing");
    }

    const url = builder(clerk);
    await invoke("open_system_browser", { url });
  };

  const signIn = async () => {
    await openClerkUrl(getClerkSignInUrl);
  };

  const signUp = async () => {
    await openClerkUrl(getClerkSignUpUrl);
  };

  const signOut = async () => {
    const clerk = clerkInstance();
    if (clerk) {
      try {
        await clerk.signOut();
      } catch (error) {
        debugError("auth", "clerk.signOut failed", error);
      }
    }

    saveCachedDevBrowserToken(null);
    await syncClerkDevBrowserToken(null);

    clearAuthState();
  };

  const getToken = async (): Promise<string | null> => {
    const clerk = clerkInstance();
    if (clerk?.session) {
      try {
        return await clerk.session.getToken();
      } catch (error) {
        debugError("auth", "clerk.session.getToken() failed", error);
      }
    }
    return null;
  };

  const value: AuthContextValue = {
    user,
    isLoaded,
    isSignedIn,
    isCloudReady,
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

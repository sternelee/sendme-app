/**
 * Token-based auth bridge for the Tauri app.
 *
 * Browser is the source of truth for login completion:
 * - user signs in via better-auth hosted pages in the system browser (OAuth)
 * - browser /auth/callback resolves better-auth session -> bearer token
 * - deep link returns that verified session token to the app
 * - app persists the bearer token and user info for API/WebSocket auth
 *
 * Email/password auth is handled directly in the app via API calls to the
 * browser backend (no system browser needed).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
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
  loadCachedUser,
  saveCachedAuthSession,
  saveCachedUser,
  UserInfo,
} from "./auth-session";
import { debugError, debugInfo } from "./debug-log";

interface AuthContextValue {
  user: () => UserInfo | null;
  isLoaded: () => boolean;
  isSignedIn: () => boolean;
  isCloudReady: () => boolean;
  signIn: () => Promise<void>;
  signUp: () => Promise<void>;
  signOut: () => Promise<void>;
  clerk: () => null;
  getToken: () => Promise<string | null>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    name: string,
    email: string,
    password: string,
  ) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>();

const getAuthRedirectUrl = () =>
  `${getCloudApiOrigin()}/auth/callback?mode=tauri`;

interface CallbackCompletePayload {
  success: boolean;
  token: string | null;
  user: UserInfo | null;
}

async function apiEmailAuth(
  endpoint: "sign-in" | "sign-up",
  body: Record<string, string>,
): Promise<{ token: string; user: UserInfo }> {
  const origin = getCloudApiOrigin();

  const signInRes = await tauriFetch(`${origin}/api/auth/${endpoint}/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const signInData = (await signInRes.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!signInRes.ok) {
    const msg =
      typeof signInData.message === "string"
        ? signInData.message
        : typeof signInData.error === "string"
          ? signInData.error
          : `Authentication failed (${signInRes.status})`;
    throw new Error(msg);
  }

  // better-auth may return token directly in the response body
  let token: string | undefined =
    typeof signInData.token === "string" ? signInData.token : undefined;

  if (!token) {
    const session = signInData.session as Record<string, unknown> | undefined;
    if (typeof session?.token === "string") {
      token = session.token;
    }
  }

  // Fallback: read Set-Cookie header and call /api/auth/token
  if (!token) {
    const setCookie = signInRes.headers.get("set-cookie");
    const tokenRes = await tauriFetch(`${origin}/api/auth/token`, {
      method: "GET",
      headers: setCookie ? { Cookie: setCookie } : undefined,
    });

    if (tokenRes.ok) {
      const tokenData = await tokenRes
        .json()
        .catch(() => ({}) as Record<string, unknown>);
      if (typeof tokenData.token === "string") {
        token = tokenData.token;
      }
    }
  }

  if (!token) {
    throw new Error("Failed to obtain authentication token");
  }

  // Get user info from session endpoint
  const userRes = await tauriFetch(`${origin}/api/auth/get-session`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  let user: UserInfo | null = null;
  if (userRes.ok) {
    const sessionData = (await userRes.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const u = sessionData?.user as Record<string, unknown> | undefined;
    if (u && typeof u.id === "string" && typeof u.email === "string") {
      user = {
        id: u.id,
        email: u.email,
        name: (typeof u.name === "string" ? u.name : u.email) || u.email,
        imageUrl: typeof u.image === "string" ? u.image : undefined,
      };
    }
  }

  if (!user) {
    // Fallback: try to extract user from sign-in response
    const u = signInData.user as Record<string, unknown> | undefined;
    if (u && typeof u.id === "string" && typeof u.email === "string") {
      user = {
        id: u.id,
        email: u.email,
        name: (typeof u.name === "string" ? u.name : u.email) || u.email,
        imageUrl: typeof u.image === "string" ? u.image : undefined,
      };
    } else {
      throw new Error("Failed to get user information");
    }
  }

  return { token, user };
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

    if (callbackUser) {
      setUser(callbackUser);
    }

    if (callbackSession) {
      await applySession(callbackSession, callbackUser ?? user());
    }

    setIsCloudReady(true);
  };

  onMount(() => {
    let callbackUnlisten: (() => void) | undefined;
    let deepLinkUnlisten: (() => void) | undefined;
    let disposed = false;

    const bootstrap = async () => {
      try {
        callbackUnlisten = await listen<CallbackCompletePayload>(
          "auth-callback-complete",
          async (event) => {
            if (disposed) return;
            const payload = event.payload;

            if (payload.token) {
              const newSession: CachedAuthSession = {
                token: payload.token,
              };
              await applySession(newSession, payload.user ?? user());
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

      // Wire cloud-api token source immediately
      initCloudApi(getToken);

      setIsLoaded(true);
      setIsCloudReady(true);
      debugInfo("auth", "Auth provider loaded; using token-based auth");
    };

    void bootstrap();

    onCleanup(() => {
      disposed = true;
      callbackUnlisten?.();
      deepLinkUnlisten?.();
    });
  });

  const openAuthUrl = async (url: string) => {
    await invoke("open_system_browser", { url });
  };

  const signIn = async () => {
    await openAuthUrl(getAuthRedirectUrl());
  };

  const signUp = async () => {
    await openAuthUrl(getAuthRedirectUrl());
  };

  const signOut = async () => {
    clearAuthState();
  };

  const getToken = async (): Promise<string | null> => {
    const cached = session();
    if (hasUsableCachedAuthSession(cached)) {
      return cached.token;
    }
    return null;
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { token, user: u } = await apiEmailAuth("sign-in", {
      email,
      password,
    });
    const newSession = createCachedAuthSession(token);
    await applySession(newSession, u);
    setIsCloudReady(true);
  };

  const signUpWithEmail = async (
    name: string,
    email: string,
    password: string,
  ) => {
    const { token, user: u } = await apiEmailAuth("sign-up", {
      name,
      email,
      password,
      callbackURL: "/app",
    });
    const newSession = createCachedAuthSession(token);
    await applySession(newSession, u);
    setIsCloudReady(true);
  };

  const value: AuthContextValue = {
    user,
    isLoaded,
    isSignedIn,
    isCloudReady,
    signIn,
    signUp,
    signOut,
    clerk: () => null,
    getToken,
    signInWithEmail,
    signUpWithEmail,
  };

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

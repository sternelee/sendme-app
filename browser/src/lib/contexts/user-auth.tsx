/**
 * User Auth Context using better-auth
 * Provides authentication state and actions to the app
 */

import {
  createContext,
  useContext,
  ParentComponent,
  createSignal,
  createEffect,
} from "solid-js";
import { authClient } from "../auth-client";

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
  signIn: () => void;
  signUp: () => void;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>();

/**
 * Auth Provider Component
 * Wraps the app to provide authentication context
 */
export const AuthProvider: ParentComponent = (props) => {
  const [user, setUser] = createSignal<UserInfo | null>(null);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [isSignedIn, setIsSignedIn] = createSignal(false);

  const session = authClient.useSession();

  createEffect(() => {
    const s = session();
    setIsLoaded(!s.isPending);
    setIsSignedIn(!!s.data);

    if (s.data?.user) {
      const u = s.data.user;
      setUser({
        id: u.id,
        email: u.email,
        name: u.name || u.email,
        imageUrl: u.image || undefined,
      });
    } else {
      setUser(null);
    }
  });

  const signIn = () => {
    window.location.href = "/auth/sign-in";
  };

  const signUp = () => {
    window.location.href = "/auth/sign-up";
  };

  const signOut = async () => {
    await authClient.signOut();
    setUser(null);
    setIsSignedIn(false);
  };

  const getToken = async (): Promise<string | null> => {
    try {
      // The session cookie is HttpOnly so we can't read it from JS.
      // We use a dedicated endpoint to get the bearer token.
      const res = await fetch("/api/auth/token", {
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { token?: string };
      return data.token || null;
    } catch {
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
    getToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {props.children}
    </AuthContext.Provider>
  );
};

/**
 * Hook to use authentication context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

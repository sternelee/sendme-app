/**
 * Clerk Auth for Tauri Desktop App
 * Uses Clerk JS SDK with mountUserButton and mountSignIn
 */

import { Clerk } from "@clerk/clerk-js";
import {
  createContext,
  useContext,
  createSignal,
  onMount,
  JSX,
} from "solid-js";

const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "pk_test_your_key";

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
}

const AuthContext = createContext<AuthContextValue>();

/**
 * Auth Provider for Tauri Desktop App
 */
export function AuthProvider(props: { children: JSX.Element }) {
  const [user, setUser] = createSignal<UserInfo | null>(null);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [isSignedIn, setIsSignedIn] = createSignal(false);
  const [clerkInstance, setClerkInstance] = createSignal<Clerk | null>(null);

  onMount(async () => {
    // Create Clerk instance
    const clerk = new Clerk(CLERK_PUBLISHABLE_KEY);
    setClerkInstance(clerk);

    await clerk.load();

    // Check sign-in status
    if (clerk.isSignedIn) {
      setIsSignedIn(true);

      // Get user info
      const userData = clerk.user;
      if (userData) {
        setUser({
          id: userData.id,
          email: userData.emailAddresses[0]?.emailAddress || "",
          name: userData.fullName || userData.username || "",
          imageUrl: userData.imageUrl,
        });
      }
    }
    setIsLoaded(true);

    // Listen for session changes
    clerk.addListener(({ user: clerkUser }) => {
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
  });

  const signIn = async () => {
    const clerk = clerkInstance();
    if (clerk) {
      clerk.openSignIn({
        routing: "hash",
        forceRedirectUrl: window.location.href,
      });
    }
  };

  const signUp = async () => {
    const clerk = clerkInstance();
    if (clerk) {
      clerk.openSignUp({
        routing: "hash",
        forceRedirectUrl: window.location.href,
      });
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

  const value: AuthContextValue = {
    user,
    isLoaded,
    isSignedIn,
    signIn,
    signUp,
    signOut,
    clerk: clerkInstance,
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

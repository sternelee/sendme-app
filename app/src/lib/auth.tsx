/**
 * Clerk Auth for Tauri Desktop App
 * Uses tauri-plugin-clerk for native Tauri authentication
 */

import { Clerk } from "@clerk/clerk-js";
import { initClerk } from "tauri-plugin-clerk";
import {
  createContext,
  useContext,
  createSignal,
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
}

const AuthContext = createContext<AuthContextValue>();

const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "pk_test_placeholder";

/**
 * Auth Provider for Tauri Desktop App
 */
export function AuthProvider(props: { children: JSX.Element }) {
  const [user, setUser] = createSignal<UserInfo | null>(null);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [isSignedIn, setIsSignedIn] = createSignal(false);
  const [clerkInstance, setClerkInstance] = createSignal<Clerk | null>(null);

  onMount(async () => {
    try {
      // Initialize clerk using tauri-plugin-clerk
      // initClerk returns a Promise<Clerk> that resolves when clerk is ready
      const clerk = await initClerk({
        publishableKey: CLERK_PUBLISHABLE_KEY,
      });
      setClerkInstance(clerk);

      // Check sign-in status
      if (clerk.user) {
        setIsSignedIn(true);
        setUser({
          id: clerk.user.id,
          email: clerk.user.emailAddresses[0]?.emailAddress || "",
          name: clerk.user.fullName || clerk.user.username || "",
          imageUrl: clerk.user.imageUrl,
        });
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
    } catch (error) {
      console.error("Failed to initialize Clerk:", error);
      setIsLoaded(true);
    }
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

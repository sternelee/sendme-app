/**
 * User Context Provider using @clerk/clerk-js
 * Provides authentication state and actions to the app
 */

import {
  createContext,
  useContext,
  createSignal,
  ParentComponent,
  onMount,
} from "solid-js";
import { Clerk } from "@clerk/clerk-js";
import { getClerk } from "../clerk-provider";

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
  const [clerkInstance, setClerkInstance] = createSignal<Clerk | null>(null);

  // Load user on mount
  onMount(async () => {
    // Wait for clerk to be available
    const waitForClerk = () => {
      return new Promise<Clerk>((resolve) => {
        const check = () => {
          const clerk = getClerk();
          if (clerk) {
            resolve(clerk);
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
    };

    try {
      const clerk = await waitForClerk();
      setClerkInstance(clerk);

      if (clerk.isSignedIn) {
        setIsSignedIn(true);
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
    } catch (error) {
      console.error("[Auth] Error loading user:", error);
      setIsLoaded(true);
    }
  });

  /**
   * Sign in using Clerk's modal
   */
  const signIn = async () => {
    const clerk = clerkInstance();
    if (clerk) {
      clerk.openSignIn({
        routing: "hash",
        forceRedirectUrl: window.location.href,
      });
    }
  };

  /**
   * Sign up using Clerk's modal
   */
  const signUp = async () => {
    const clerk = clerkInstance();
    if (clerk) {
      clerk.openSignUp({
        routing: "hash",
        forceRedirectUrl: window.location.href,
      });
    }
  };

  /**
   * Sign out
   */
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
  };

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
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

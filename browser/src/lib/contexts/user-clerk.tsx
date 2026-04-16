/**
 * User Context Provider using clerk-solidjs
 * Provides authentication state and actions to the app
 */

import { createContext, useContext, ParentComponent, createSignal, createEffect } from "solid-js";
import { useAuth as useClerkAuth, SignedIn, SignedOut, SignInButton, UserButton, ClerkLoading, ClerkLoaded } from "clerk-solidjs";

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
  signOut: () => void;
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

  // Use clerk-solidjs hook — these are already reactive signals
  const { userId, isLoaded: clerkIsLoaded, isSignedIn: clerkIsSignedIn } = useClerkAuth();

  // Sync local signals with Clerk's reactive state — no polling needed
  createEffect(() => {
    setIsLoaded(clerkIsLoaded());
    const signedIn = clerkIsSignedIn();
    setIsSignedIn(!!signedIn);

    if (signedIn && userId()) {
      setUser({
        id: userId() || "",
        email: "",
        name: "",
      });
    } else {
      setUser(null);
    }
  });

  /**
   * Sign in using Clerk's component
   */
  const signIn = () => {
    // The SignInButton component will handle this
    // This is a placeholder - users should use <SignInButton> component directly
  };

  /**
   * Sign up using Clerk's component
   */
  const signUp = () => {
    // The SignInButton component with mode="signUp" will handle this
    // This is a placeholder - users should use <SignInButton> component directly
  };

  /**
   * Sign out
   */
  const signOut = () => {
    // Clerk's UserButton handles sign out automatically
    // This is a placeholder
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

// Re-export clerk-solidjs components for convenience
export { SignedIn, SignedOut, SignInButton, UserButton, ClerkLoading, ClerkLoaded };

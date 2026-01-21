/**
 * User Context Provider with Better Auth
 * Manages user authentication state using better-auth
 * Uses better-auth's react hooks which work with SolidJS
 */

import {
  createContext,
  useContext,
  ParentComponent,
  createEffect,
  createSignal,
} from "solid-js";
import {
  authClient,
  signInWithSocial,
  signInWithEmail,
  signUpWithEmail,
  signOut,
} from "../auth-client";

/**
 * User interface from better-auth
 */
export type User = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified: boolean;
  createdAt: number | Date;
  updatedAt: number | Date;
};

/**
 * Auth context interface
 */
export interface AuthContextType {
  user: () => User | null;
  isAuthenticated: () => boolean;
  isLoading: () => boolean;
  login: (
    provider: "github" | "google" | "email",
    data?: { email: string; password: string },
  ) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    name: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Auth context
 */
const AuthContext = createContext<AuthContextType>();

/**
 * Auth Provider Component
 */
export const AuthProvider: ParentComponent = (props) => {
  const [user, setUser] = createSignal<User | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);

  // Use better-auth's getSession to get initial session
  const fetchSession = async () => {
    try {
      const session = await authClient.getSession();
      setUser(session.data?.user || null);
    } catch (error) {
      console.error("Failed to fetch session:", error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    fetchSession();
  });

  /**
   * Login function with OAuth or email
   */
  const login = async (
    provider: "github" | "google" | "email",
    data?: { email: string; password: string },
  ) => {
    if (provider === "email") {
      if (!data) {
        throw new Error("Email and password required");
      }
      await signInWithEmail(data.email, data.password);
    } else {
      await signInWithSocial(provider);
    }
  };

  /**
   * Register function
   */
  const register = async (data: {
    email: string;
    password: string;
    name: string;
  }) => {
    await signUpWithEmail(data);
  };

  /**
   * Logout function
   */
  const logout = async () => {
    await signOut();
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: () => !!user(),
    isLoading,
    login,
    register,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
};

/**
 * Hook to use auth context
 */
export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}

/**
 * Hook to require authentication
 */
export function useRequireAuth() {
  const auth = useAuth();

  return {
    user: auth.user,
    isAuthenticated: auth.isAuthenticated,
    isLoading: auth.isLoading,
  };
}

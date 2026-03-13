/**
 * Clerk Provider Component
 * Loads Clerk and provides authentication to the app
 */

import { ParentComponent, createSignal, onMount, createRoot } from "solid-js";
import { Clerk } from "@clerk/clerk-js";

const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "pk_test_your_key";

// Create a global store for clerk instance
const clerkStore = createRoot(() => {
  const [clerk, setClerk] = createSignal<Clerk | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  return { clerk, setClerk, loaded, setLoaded };
});

/**
 * Clerk Provider
 * Initializes Clerk and provides the instance
 */
export const ClerkProvider: ParentComponent = (props) => {
  onMount(async () => {
    // Skip if already loaded
    if (clerkStore.loaded()) return;

    try {
      const clerkInstance = new Clerk(CLERK_PUBLISHABLE_KEY);

      // Set to window immediately so it's available
      (window as any).Clerk = clerkInstance;

      await clerkInstance.load();

      clerkStore.setClerk(clerkInstance);
      clerkStore.setLoaded(true);

      console.log("Clerk loaded successfully");
    } catch (error) {
      console.error("Failed to load Clerk:", error);
      clerkStore.setLoaded(true);
    }
  });

  return <>{props.children}</>;
};

// Helper to get clerk instance
export function getClerk(): Clerk | null {
  return clerkStore.clerk() || (window as any).Clerk;
}

// Helper to check if clerk is loaded
export function isClerkLoaded(): boolean {
  return clerkStore.loaded();
}

// Helper to wait for clerk to be loaded
export async function waitForClerk(): Promise<Clerk> {
  return new Promise((resolve) => {
    const check = () => {
      const clerk = getClerk();
      if (clerk && clerkStore.loaded()) {
        resolve(clerk);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

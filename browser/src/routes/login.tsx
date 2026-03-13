/**
 * Login Page
 * Uses Clerk for authentication - opens Clerk modal for sign in
 */

import { createSignal, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { TbOutlineSparkles } from "solid-icons/tb";
import { getClerk, isClerkLoaded, waitForClerk } from "~/lib/clerk-provider";

export default function LoginPage() {
  const [isLoading, setIsLoading] = createSignal(true);
  const navigate = useNavigate();

  onMount(async () => {
    // Wait for Clerk to load
    await waitForClerk();

    const clerk = getClerk();
    if (!clerk) {
      setIsLoading(false);
      return;
    }

    // Check if already signed in
    if (clerk.isSignedIn) {
      navigate("/app");
      return;
    }

    setIsLoading(false);

    // Listen for successful auth
    clerk.addListener(({ user }) => {
      if (user) {
        navigate("/app");
      }
    });
  });

  const handleSignIn = async () => {
    // Ensure clerk is loaded
    if (!isClerkLoaded()) {
      await waitForClerk();
    }

    const clerk = getClerk();
    if (clerk) {
      clerk.openSignIn({
        routing: "hash",
        forceRedirectUrl: window.location.origin + "/app",
      });
    }
  };

  const handleSignUp = async () => {
    // Ensure clerk is loaded
    if (!isClerkLoaded()) {
      await waitForClerk();
    }

    const clerk = getClerk();
    if (clerk) {
      clerk.openSignUp({
        routing: "hash",
        forceRedirectUrl: window.location.origin + "/app",
      });
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-gradient-to-br from-purple-50 via-indigo-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-indigo-900/20">
      <Show
        when={!isLoading()}
        fallback={
          <div class="flex items-center justify-center">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          </div>
        }
      >
        <div class="max-w-md w-full space-y-8">
          {/* Header */}
          <div class="text-center">
            <a
              href="/"
              class="inline-flex items-center gap-3 text-gray-900 dark:text-white hover:opacity-80 transition-opacity"
            >
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <TbOutlineSparkles size={24} class="text-white" />
              </div>
              <span class="text-3xl font-bold">Sendme</span>
            </a>
            <h2 class="mt-6 text-3xl font-bold text-gray-900 dark:text-white">
              Sign in to your account
            </h2>
            <p class="mt-3 text-gray-600 dark:text-gray-400">
              Secure P2P file transfer powered by Clerk
            </p>
          </div>

          {/* Card */}
          <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            {/* Sign In Button */}
            <button
              type="button"
              onClick={handleSignIn}
              class="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
            >
              Sign In
            </button>

            {/* Divider */}
            <div class="relative my-6">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-gray-300 dark:border-gray-600"></div>
              </div>
              <div class="relative flex justify-center text-sm">
                <span class="px-4 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  or
                </span>
              </div>
            </div>

            {/* Sign Up Button */}
            <button
              type="button"
              onClick={handleSignUp}
              class="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <span class="text-gray-700 dark:text-gray-300 font-medium">
                Sign Up / Register
              </span>
            </button>
          </div>

          {/* Footer */}
          <div class="text-center text-sm text-gray-600 dark:text-gray-400">
            <p>
              <a
                href="/"
                class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Back to home
              </a>
            </p>
          </div>
        </div>
      </Show>
    </div>
  );
}

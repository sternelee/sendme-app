/**
 * Register Page
 * Uses Clerk for authentication - opens Clerk modal for sign up
 */

import { onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { TbOutlineSparkles } from "solid-icons/tb";
import { useAuth, ClerkLoading, SignedIn, SignedOut, SignInButton } from "clerk-solidjs";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();

  onMount(() => {
    // Redirect if already signed in
    if (isSignedIn()) {
      navigate("/app");
    }
  });

  return (
    <ClerkLoading>
      <div class="min-h-screen flex items-center justify-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    </ClerkLoading>
  );
}

export function RegisterContent() {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();

  onMount(() => {
    if (isSignedIn()) {
      navigate("/app");
    }
  });

  return (
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
          Create your account
        </h2>
        <p class="mt-3 text-gray-600 dark:text-gray-400">
          Join Sendme for secure P2P file transfer
        </p>
      </div>

      {/* Card */}
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
        {/* SignUpButton - opens Clerk sign-up modal */}
        <SignedOut>
          <SignInButton mode="modal">
            <button
              type="button"
              class="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              Create Account
            </button>
          </SignInButton>
        </SignedOut>

        <SignedIn>
          <a
            href="/app"
            class="block w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 text-center"
          >
            Go to App
          </a>
        </SignedIn>

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

        {/* Sign In Link */}
        <div class="text-center text-sm text-gray-600 dark:text-gray-400">
          Already have an account?{" "}
          <a
            href="/login"
            class="font-medium text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300"
          >
            Sign in
          </a>
        </div>
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
  );
}

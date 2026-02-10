/**
 * Login Page
 * Standalone login page with email/password and OAuth options (GitHub, Google)
 * Using better-auth for authentication
 */

import { createSignal, Show } from "solid-js";
import { useAuth } from "../lib/contexts/user-better-auth";
import {
  TbOutlineSparkles,
  TbOutlineBrandGithub,
  TbOutlineBrandGoogle,
} from "solid-icons/tb";
import toast, { Toaster } from "solid-toast";

export default function LoginPage() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [isOAuthLoading, setIsOAuthLoading] = createSignal<string | null>(null);

  const auth = useAuth();

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (!email() || !password()) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsLoading(true);

    try {
      await auth.login("email", { email: email(), password: password() });
      toast.success("Logged in successfully!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGitHubLogin = async () => {
    setIsOAuthLoading("github");
    try {
      await auth.login("github");
    } catch (error) {
      toast.error("GitHub login failed");
      setIsOAuthLoading(null);
    }
  };

  const handleGoogleLogin = async () => {
    setIsOAuthLoading("google");
    try {
      await auth.login("google");
    } catch (error) {
      toast.error("Google login failed");
      setIsOAuthLoading(null);
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-gradient-to-br from-purple-50 via-indigo-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-indigo-900/20">
      <Toaster position="top-center" />

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
            Welcome back! Please enter your details
          </p>
        </div>

        {/* Card */}
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          {/* OAuth Buttons */}
          <div class="space-y-3 mb-6">
            <button
              type="button"
              onClick={handleGitHubLogin}
              disabled={isOAuthLoading() !== null}
              class="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Show when={isOAuthLoading() !== "github"}>
                <TbOutlineBrandGithub
                  size={20}
                  class="text-gray-900 dark:text-gray-100"
                />
              </Show>
              <Show when={isOAuthLoading() === "github"}>
                <svg
                  class="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              </Show>
              <Show when={isOAuthLoading() !== "github"}>
                <span class="text-gray-700 dark:text-gray-300 font-medium">
                  Continue with GitHub
                </span>
              </Show>
              <Show when={isOAuthLoading() === "github"}>
                <span class="text-gray-700 dark:text-gray-300 font-medium">
                  Connecting...
                </span>
              </Show>
            </button>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isOAuthLoading() !== null}
              class="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Show when={isOAuthLoading() !== "google"}>
                <TbOutlineBrandGoogle
                  size={20}
                  class="text-gray-900 dark:text-gray-100"
                />
              </Show>
              <Show when={isOAuthLoading() === "google"}>
                <svg
                  class="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              </Show>
              <Show when={isOAuthLoading() !== "google"}>
                <span class="text-gray-700 dark:text-gray-300 font-medium">
                  Continue with Google
                </span>
              </Show>
              <Show when={isOAuthLoading() === "google"}>
                <span class="text-gray-700 dark:text-gray-300 font-medium">
                  Connecting...
                </span>
              </Show>
            </button>
          </div>

          {/* Divider */}
          <div class="relative mb-6">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-gray-300 dark:border-gray-600"></div>
            </div>
            <div class="relative flex justify-center text-sm">
              <span class="px-4 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                Or continue with email
              </span>
            </div>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} class="space-y-5">
            <div>
              <label
                for="email"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                placeholder="Enter your email"
                disabled={isLoading()}
                required
              />
            </div>

            <div>
              <label
                for="password"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                placeholder="Enter your password"
                disabled={isLoading()}
                required
              />
            </div>

            <div class="flex items-center justify-between">
              <a
                href="/forgot-password"
                class="text-sm text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300"
              >
                Forgot password?
              </a>
            </div>

            <button
              type="submit"
              disabled={isLoading()}
              class="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Show when={isLoading()}>
                <svg
                  class="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              </Show>
              <Show when={!isLoading()}>Sign In</Show>
              <Show when={isLoading()}>Signing in...</Show>
            </button>
          </form>
        </div>

        {/* Footer */}
        <div class="text-center text-sm text-gray-600 dark:text-gray-400">
          <p>
            Don't have an account?{" "}
            <a
              href="/register"
              class="font-medium text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300"
            >
              Sign up
            </a>
          </p>
          <p class="mt-2">
            <a
              href="/"
              class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Back to home
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

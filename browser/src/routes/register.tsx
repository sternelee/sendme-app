/**
 * Register Page
 * Standalone register page with email/password and OAuth options (GitHub, Google)
 * Using better-auth for authentication
 */

import { createSignal, Show, For } from "solid-js";
import { useAuth } from "../lib/contexts/user-better-auth";
import {
  TbOutlineSparkles,
  TbOutlineBrandGithub,
  TbOutlineBrandGoogle,
} from "solid-icons/tb";
import toast, { Toaster } from "solid-toast";

export default function RegisterPage() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [name, setName] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [isOAuthLoading, setIsOAuthLoading] = createSignal<string | null>(null);
  const [errors, setErrors] = createSignal<string[]>([]);

  const auth = useAuth();

  const validateForm = () => {
    const newErrors: string[] = [];

    if (!name()) {
      newErrors.push("Name is required");
    } else if (name().length > 50) {
      newErrors.push("Name must be at most 50 characters");
    }

    if (!email()) {
      newErrors.push("Email is required");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email())) {
      newErrors.push("Invalid email format");
    }

    if (!password()) {
      newErrors.push("Password is required");
    } else if (password().length < 8) {
      newErrors.push("Password must be at least 8 characters");
    }

    if (password() !== confirmPassword()) {
      newErrors.push("Passwords do not match");
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setErrors([]);

    try {
      await auth.register({
        email: email(),
        password: password(),
        name: name(),
      });
      toast.success("Account created successfully!");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Registration failed";
      setErrors([message]);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGitHubLogin = async () => {
    setIsOAuthLoading("github");
    try {
      await auth.login("github");
    } catch (error) {
      toast.error("GitHub registration failed");
      setIsOAuthLoading(null);
    }
  };

  const handleGoogleLogin = async () => {
    setIsOAuthLoading("google");
    try {
      await auth.login("google");
    } catch (error) {
      toast.error("Google registration failed");
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
            Create your account
          </h2>
          <p class="mt-3 text-gray-600 dark:text-gray-400">
            Join Sendme to share files securely
          </p>
        </div>

        {/* Card */}
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          {/* Errors */}
          <Show when={errors().length > 0}>
            <div class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <For each={errors()}>
                {(error) => (
                  <p class="text-sm text-red-600 dark:text-red-400">{error}</p>
                )}
              </For>
            </div>
          </Show>

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
                Or create account with email
              </span>
            </div>
          </div>

          {/* Register Form */}
          <form onSubmit={handleSubmit} class="space-y-5">
            <div>
              <label
                for="name"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Full Name
              </label>
              <input
                id="name"
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                placeholder="John Doe"
                disabled={isLoading()}
                required
              />
            </div>

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
                placeholder="john@example.com"
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
                placeholder="Min 8 characters"
                disabled={isLoading()}
                required
              />
            </div>

            <div>
              <label
                for="confirmPassword"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword()}
                onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                placeholder="Confirm your password"
                disabled={isLoading()}
                required
              />
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
              <Show when={!isLoading()}>Create Account</Show>
              <Show when={isLoading()}>Creating account...</Show>
            </button>
          </form>
        </div>

        {/* Footer */}
        <div class="text-center text-sm text-gray-600 dark:text-gray-400">
          <p>
            Already have an account?{" "}
            <a
              href="/login"
              class="font-medium text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300"
            >
              Sign in
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

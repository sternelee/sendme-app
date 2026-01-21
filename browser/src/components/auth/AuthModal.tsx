/**
 * Auth Modal Component
 * Combines login and register forms in a tabbed interface
 */

import { createSignal, Show } from "solid-js";
import LoginForm from "./LoginForm";
import RegisterForm from "./RegisterForm";

export default function AuthModal() {
  const [activeTab, setActiveTab] = createSignal<"login" | "register">("login");

  return (
    <div class="min-h-screen flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-gradient-to-br from-purple-50 via-indigo-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-indigo-900/20">
      <div class="max-w-md w-full space-y-8">
        {/* Header */}
        <div class="text-center">
          <h2 class="text-4xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
            Sendme Browser
          </h2>
          <p class="mt-3 text-gray-600 dark:text-gray-400">
            <Show when={activeTab() === "login"}>
              Sign in to your account to continue
            </Show>
            <Show when={activeTab() === "register"}>
              Create a new account to get started
            </Show>
          </p>
        </div>

        {/* Card */}
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          {/* Tabs */}
          <div class="flex space-x-2 mb-8 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab("login")}
              class={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
                activeTab() === "login"
                  ? "bg-white dark:bg-gray-600 text-purple-600 dark:text-purple-400 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("register")}
              class={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
                activeTab() === "register"
                  ? "bg-white dark:bg-gray-600 text-purple-600 dark:text-purple-400 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Forms */}
          <Show when={activeTab() === "login"}>
            <LoginForm />
          </Show>

          <Show when={activeTab() === "register"}>
            <RegisterForm />
          </Show>
        </div>

        {/* Footer */}
        <div class="text-center text-sm text-gray-500 dark:text-gray-400">
          <Show when={activeTab() === "login"}>
            <p>
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => setActiveTab("register")}
                class="font-medium text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300"
              >
                Sign up
              </button>
            </p>
          </Show>
          <Show when={activeTab() === "register"}>
            <p>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => setActiveTab("login")}
                class="font-medium text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300"
              >
                Sign in
              </button>
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
}

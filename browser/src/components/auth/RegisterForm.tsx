/**
 * Register Form Component
 */

import { createSignal, Show, For } from "solid-js";
import { useAuth } from "~/lib/contexts/user-better-auth";
import toast, { Toaster } from "solid-toast";

export default function RegisterForm() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [name, setName] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [errors, setErrors] = createSignal<string[]>([]);

  const auth = useAuth();

  const validateForm = () => {
    const newErrors: string[] = [];

    if (!email()) {
      newErrors.push("Email is required");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email())) {
      newErrors.push("Invalid email format");
    }

    if (!name()) {
      newErrors.push("Name is required");
    } else if (name().length > 50) {
      newErrors.push("Name must be at most 50 characters");
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

  return (
    <>
      <Toaster position="top-center" />
      <form onSubmit={handleSubmit} class="space-y-5">
        <Show when={errors().length > 0}>
          <div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <For each={errors()}>
              {(error) => (
                <p class="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </For>
          </div>
        </Show>

        <div>
          <label
            for="name"
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
            class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
            class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            placeholder="Min 8 chars, 1 uppercase, 1 lowercase, 1 number"
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
            class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
    </>
  );
}

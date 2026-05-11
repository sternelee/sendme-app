/**
 * Sign In Page
 * Email/password and OAuth sign-in using better-auth
 */

import { createSignal, Show } from "solid-js";
import { Motion } from "solid-motionone";
import { authClient } from "~/lib/auth-client";
import { TbOutlineBrandGithub, TbOutlineBrandGoogle } from "solid-icons/tb";

export default function SignInPage() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleEmailSignIn = async (e: Event) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({
        email: email(),
        password: password(),
        callbackURL: "/app",
      });
      if (result.error) {
        setError(result.error.message || "Sign in failed");
      } else {
        window.location.href = "/app";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: "github" | "google") => {
    setLoading(true);
    setError(null);
    try {
      // Use fetch with redirect:"manual" so we can read the 302 Location header.
      // The auth client's signIn.social uses fetch which follows 302s silently
      // and keeps the page stuck.
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, callbackURL: "/app" }),
        redirect: "manual",
        credentials: "include",
      });

      // Server returns 302 redirect to the OAuth provider
      if (response.status === 302 || response.status === 301) {
        const location = response.headers.get("Location");
        if (location) {
          window.location.href = location;
          return;
        }
      }

      // Fallback: if server returns JSON with a URL (e.g. disableRedirect mode)
      const data = (await response.json().catch(() => null)) as {
        url?: string;
        data?: { url?: string };
        error?: { message?: string };
      };
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      if (data?.data?.url) {
        window.location.href = data.data.url;
        return;
      }

      setError(data?.error?.message || "OAuth sign in failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        class="w-full max-w-md"
      >
        <div class="text-center mb-8">
          <a href="/" class="inline-flex items-center gap-2 text-xl font-bold">
            <div class="w-8 h-8 rounded-lg bg-primary text-primary-content flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5"/><path d="M12 12v9"/></svg>
            </div>
            <span>Sendme</span>
          </a>
          <h1 class="text-2xl font-bold mt-6">Welcome back</h1>
          <p class="text-base-content/60 mt-2">Sign in to your account</p>
        </div>

        <div class="bg-base-200 rounded-2xl p-6 space-y-4">
          <Show when={error()}>
            <div class="p-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm">
              {error()}
            </div>
          </Show>

          <form onSubmit={handleEmailSignIn} class="space-y-3">
            <div>
              <label class="label text-sm font-medium">Email</label>
              <input
                type="email"
                class="input input-bordered w-full"
                placeholder="you@example.com"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                required
              />
            </div>
            <div>
              <label class="label text-sm font-medium">Password</label>
              <input
                type="password"
                class="input input-bordered w-full"
                placeholder="••••••••"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                required
              />
            </div>
            <button
              type="submit"
              class="btn btn-primary w-full"
              disabled={loading()}
            >
              {loading() ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div class="relative">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-base-300" />
            </div>
            <div class="relative flex justify-center text-xs">
              <span class="bg-base-200 px-2 text-base-content/50">or continue with</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <button
              class="btn btn-outline gap-2"
              onClick={() => handleOAuth("github")}
            >
              <TbOutlineBrandGithub size={18} />
              GitHub
            </button>
            <button
              class="btn btn-outline gap-2"
              onClick={() => handleOAuth("google")}
            >
              <TbOutlineBrandGoogle size={18} />
              Google
            </button>
          </div>
        </div>

        <p class="text-center text-sm text-base-content/60 mt-6">
          Don't have an account?{" "}
          <a href="/auth/sign-up" class="link link-primary">Sign up</a>
        </p>
      </Motion.div>
    </div>
  );
}

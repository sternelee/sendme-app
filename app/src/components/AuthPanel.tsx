import { createSignal, Show, JSX } from "solid-js";
import { useAuth } from "~/lib/auth";
import { i18n } from "@sendme/shared";
import { User, Mail, Lock, KeyRound } from "lucide-solid";

const t = i18n.t;

interface AuthPanelProps {
  icon?: JSX.Element;
}

export default function AuthPanel(props: AuthPanelProps) {
  const auth = useAuth();
  const [authMode, setAuthMode] = createSignal<"sign-in" | "sign-up">(
    "sign-in",
  );
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [name, setName] = createSignal("");
  const [authLoading, setAuthLoading] = createSignal(false);
  const [authError, setAuthError] = createSignal<string | null>(null);

  const handleSubmit = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (authMode() === "sign-in") {
        await auth.signInWithEmail(email(), password());
      } else {
        await auth.signUpWithEmail(name(), email(), password());
      }
      setEmail("");
      setPassword("");
      setName("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : t("common.authFailed"));
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div class="surface-card space-y-4 p-5">
      <div class="flex items-center gap-3">
        <div class="avatar placeholder">
          <div class="bg-primary text-primary-content flex w-12 items-center justify-center rounded-xl">
            {props.icon ?? <User size={20} />}
          </div>
        </div>
        <div class="flex-1">
          <p class="font-semibold">{t("common.account")}</p>
          <p class="text-xs opacity-60">{t("common.signInToSync")}</p>
        </div>
      </div>

      <Show when={authError()}>
        <div class="alert alert-error text-sm">{authError()}</div>
      </Show>

      <Show when={authMode() === "sign-up"}>
        <div>
          <label class="label text-sm font-medium">{t("common.name")}</label>
          <div class="relative">
            <KeyRound
              size={16}
              class="text-base-content/40 absolute top-1/2 left-3 -translate-y-1/2"
            />
            <input
              type="text"
              class="input input-bordered w-full pl-10"
              placeholder="Your name"
              aria-label={t("common.name")}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </div>
        </div>
      </Show>

      <div>
        <label class="label text-sm font-medium">{t("common.email")}</label>
        <div class="relative">
          <Mail
            size={16}
            class="text-base-content/40 absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            type="email"
            class="input input-bordered w-full pl-10"
            placeholder="you@example.com"
            aria-label={t("common.email")}
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
        </div>
      </div>

      <div>
        <label class="label text-sm font-medium">{t("common.password")}</label>
        <div class="relative">
          <Lock
            size={16}
            class="text-base-content/40 absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            type="password"
            class="input input-bordered w-full pl-10"
            placeholder="••••••••"
            aria-label={t("common.password")}
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </div>
      </div>

      <button
        class="btn btn-primary w-full rounded-xl"
        disabled={authLoading()}
        onClick={handleSubmit}
      >
        {authLoading()
          ? t("common.loading")
          : authMode() === "sign-in"
            ? t("common.signIn")
            : t("common.signUp")}
      </button>

      <div class="text-center">
        <button
          class="link link-primary text-sm"
          onClick={() => {
            setAuthMode(authMode() === "sign-in" ? "sign-up" : "sign-in");
            setAuthError(null);
          }}
        >
          {authMode() === "sign-in"
            ? t("common.dontHaveAccount")
            : t("common.alreadyHaveAccount")}
        </button>
      </div>

      <div class="divider text-xs">{t("common.orContinueWith")}</div>

      <div class="grid grid-cols-2 gap-3">
        <button
          class="btn btn-outline gap-2 rounded-xl"
          onClick={() => auth.signIn("github")}
        >
          GitHub
        </button>
        <button
          class="btn btn-outline gap-2 rounded-xl"
          onClick={() => auth.signIn("google")}
        >
          Google
        </button>
      </div>
    </div>
  );
}

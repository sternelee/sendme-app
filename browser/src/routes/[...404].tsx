import { A } from "@solidjs/router";
import { i18n } from "~/lib/i18n";
import { TbOutlineHome, TbOutlineArrowLeft } from "solid-icons/tb";

const t = i18n.t;

export default function NotFound() {
  return (
    <main class="min-h-screen bg-base-100 flex flex-col items-center justify-center p-6 text-center">
      <div class="max-w-md space-y-6">
        <div class="text-8xl font-bold text-primary">404</div>
        <h1 class="text-2xl font-semibold">{t("notFound.title") || "Page Not Found"}</h1>
        <p class="text-base-content/60">
          {t("notFound.description") || "The page you're looking for doesn't exist or has been moved."}
        </p>
        <div class="flex items-center justify-center gap-3">
          <A href="/" class="btn btn-primary gap-2">
            <TbOutlineHome size={18} />
            {t("notFound.goHome") || "Go Home"}
          </A>
          <button
            onClick={() => window.history.back()}
            class="btn btn-ghost gap-2"
          >
            <TbOutlineArrowLeft size={18} />
            {t("notFound.goBack") || "Go Back"}
          </button>
        </div>
      </div>
    </main>
  );
}

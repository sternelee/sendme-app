import { A } from "@solidjs/router";
import { i18n } from "@sendme/shared";
import {
  TbOutlineSparkles,
  TbOutlineHome,
  TbOutlineShield,
  TbOutlineBolt,
  TbOutlineWorld,
} from "solid-icons/tb";

const t = i18n.t;

export default function About() {
  return (
    <main class="min-h-screen bg-base-100">
      <div class="container mx-auto px-4 py-16 max-w-3xl">
        <div class="text-center mb-12">
          <div class="w-16 h-16 rounded-2xl bg-primary text-primary-content flex items-center justify-center mx-auto mb-6">
            <TbOutlineSparkles size={32} />
          </div>
          <h1 class="text-4xl font-bold mb-4">{t("about.title") || "About Sendme"}</h1>
          <p class="text-base-content/60 text-lg">
            {t("about.subtitle") || "A peer-to-peer file transfer tool built with iroh."}
          </p>
        </div>

        <div class="space-y-8">
          <div class="card bg-base-200">
            <div class="card-body space-y-4">
              <h2 class="card-title">{t("about.howItWorks") || "How It Works"}</h2>
              <p class="text-base-content/70">
                {t("about.howItWorksDesc") || "Sendme uses iroh to establish direct peer-to-peer connections. Files are transferred directly between devices without passing through any server, ensuring speed and privacy."}
              </p>
            </div>
          </div>

          <div class="grid md:grid-cols-3 gap-4">
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <TbOutlineShield size={28} class="text-primary mb-2" />
                <h3 class="font-semibold">{t("about.encrypted") || "Encrypted"}</h3>
                <p class="text-sm text-base-content/60">
                  {t("about.encryptedDesc") || "End-to-end encryption protects your data."}
                </p>
              </div>
            </div>
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <TbOutlineBolt size={28} class="text-primary mb-2" />
                <h3 class="font-semibold">{t("about.fast") || "Fast"}</h3>
                <p class="text-sm text-base-content/60">
                  {t("about.fastDesc") || "Direct connections mean maximum speed."}
                </p>
              </div>
            </div>
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <TbOutlineWorld size={28} class="text-primary mb-2" />
                <h3 class="font-semibold">{t("about.crossPlatform") || "Cross-Platform"}</h3>
                <p class="text-sm text-base-content/60">
                  {t("about.crossPlatformDesc") || "Works on web, desktop, and mobile."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="text-center mt-12">
          <A href="/" class="btn btn-primary gap-2">
            <TbOutlineHome size={18} />
            {t("about.backHome") || "Back to Home"}
          </A>
        </div>
      </div>
    </main>
  );
}

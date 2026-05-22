import { Motion } from "solid-motionone";
import { createSignal, Show } from "solid-js";
import { useAuth } from "~/lib/contexts/user-auth";
import toast from "solid-toast";
import {
  TbOutlineSparkles,
  TbOutlineUpload,
  TbOutlineDownload,
  TbOutlineDeviceLaptop,
  TbOutlineDeviceMobile,
  TbOutlineTerminal,
  TbOutlineWorld,
  TbOutlineArrowRight,
  TbOutlineShield,
  TbOutlineBolt,
  TbOutlineUsers,
  TbOutlineCopy,
} from "solid-icons/tb";
import { ThemeSwitcher, LanguageSwitcher } from "@sendme/ui";
import { i18n } from "@sendme/shared";

const t = i18n.t;

export default function HomePage() {
  const auth = useAuth();
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(t("common.copied") || "Copied!"),
      () => toast.error(t("common.copyFailed") || "Failed to copy"),
    );
  };

  return (
    <div class="min-h-screen bg-base-100 text-base-content">
      {/* Header */}
      <header class="navbar bg-base-100 border-b border-base-300 sticky top-0 z-50 px-6">
        <div class="flex-1">
          <a href="/" class="btn btn-ghost text-xl font-bold gap-2">
            <div class="w-8 h-8 rounded-lg bg-primary text-primary-content flex items-center justify-center">
              <TbOutlineSparkles size={18} />
            </div>
            <span>Sendme</span>
          </a>
        </div>
        <div class="flex-none">
          <div class="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeSwitcher />
            <div class="dropdown dropdown-end relative">
              <div
                tabindex="0"
                role="button"
                aria-haspopup="menu"
                class="btn btn-ghost btn-sm cursor-pointer"
                onKeyDown={(e) => {
                  if (e.key === "Escape") (e.currentTarget as HTMLElement).blur();
                }}
              >
                Menu
              </div>
              <ul
                tabindex="-1"
                class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-42 border border-base-200 absolute right-0 mt-2"
              >
                <Show when={!auth.isSignedIn()}>
                  <li>
                    <a href="/app" class="font-bold">
                      {t("landing.menu.launchApp")}
                    </a>
                  </li>
                  <li>
                    <a href="/auth/sign-in">{t("landing.menu.signIn")}</a>
                  </li>
                  <li>
                    <a href="/auth/sign-up">{t("landing.menu.signUp")}</a>
                  </li>
                </Show>
                <Show when={auth.isSignedIn()}>
                  <li>
                    <a href="/app" class="font-bold">
                      {t("landing.menu.goToApp")}
                    </a>
                  </li>
                  <li>
                    <button onClick={() => auth.signOut()} class="text-left w-full">
                      {t("common.signOut")}
                    </button>
                  </li>
                </Show>
              </ul>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section class="container mx-auto px-4 py-24 md:py-32">
        <div class="max-w-4xl mx-auto text-center">
          <Motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div class="badge badge-primary gap-2 mb-8">
              <span class="w-2 h-2 rounded-full bg-primary-content animate-pulse" />
              {t("landing.hero.badge") || "P2P File Transfer"}
            </div>
            <h1 class="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              <span class="text-base-content">
                {t("landing.hero.titleLine1")}
              </span>
              <br />
              <span class="text-primary">{t("landing.hero.titleLine2")}</span>
            </h1>
            <p class="text-lg md:text-xl text-base-content/60 mb-10 max-w-2xl mx-auto">
              {t("landing.hero.subtitle")}
            </p>
            <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a href="/app" class="btn btn-primary btn-lg gap-2">
                <TbOutlineSparkles size={20} />
                {t("landing.getStarted")}
              </a>
              <a
                href="https://github.com/sternelee/sendme-app"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-outline btn-lg gap-2"
              >
                <TbOutlineTerminal size={20} />
                {t("landing.viewOnGithub")}
              </a>
            </div>
          </Motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section class="bg-base-200 py-24">
        <div class="container mx-auto px-4">
          <div class="text-center mb-16">
            <h2 class="text-3xl md:text-4xl font-bold mb-4">
              {t("landing.features.title")}
            </h2>
            <p class="text-base-content/60 max-w-xl mx-auto">
              {t("landing.features.subtitle")}
            </p>
          </div>

          <div class="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                icon: TbOutlineShield,
                title: t("landing.features.encryptedTitle"),
                description: t("landing.features.encryptedDesc"),
              },
              {
                icon: TbOutlineBolt,
                title: t("landing.features.fastTitle"),
                description: t("landing.features.fastDesc"),
              },
              {
                icon: TbOutlineUsers,
                title: t("landing.features.syncTitle"),
                description: t("landing.features.syncDesc"),
              },
            ].map((feature) => (
              <div class="card bg-base-100 shadow-lg" key={feature.title}>
                <div class="card-body">
                  <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <feature.icon size={24} class="text-primary" />
                  </div>
                  <h3 class="card-title">{feature.title}</h3>
                  <p class="text-base-content/60">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Installation Section */}
      <section class="py-24">
        <div class="container mx-auto px-4">
          <div class="text-center mb-16">
            <h2 class="text-3xl md:text-4xl font-bold mb-4">
              {t("landing.install.title")}
            </h2>
            <p class="text-base-content/60 max-w-xl mx-auto">
              {t("landing.install.subtitle")}
            </p>
          </div>

          <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {/* Web */}
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <div class="w-12 h-12 rounded-xl bg-info/10 flex items-center justify-center mb-4">
                  <TbOutlineWorld size={24} class="text-info" />
                </div>
                <h3 class="card-title">{t("landing.install.webApp")}</h3>
                <p class="text-base-content/60 text-sm">
                  {t("landing.install.webAppDesc")}
                </p>
                <a href="/app" class="btn btn-info btn-outline btn-sm mt-4">
                  {t("landing.install.webAppAction")}
                </a>
              </div>
            </div>

            {/* CLI */}
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <div class="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center mb-4">
                  <TbOutlineTerminal size={24} class="text-success" />
                </div>
                <h3 class="card-title">{t("landing.install.cli")}</h3>
                <p class="text-base-content/60 text-sm">
                  {t("landing.install.cliDesc")}
                </p>
                <button
                  type="button"
                  class="btn btn-outline btn-sm mt-4 font-mono h-fit"
                  onClick={() => copyToClipboard("cargo install sendme")}
                >
                  <span>$ cargo install sendme</span>
                  <TbOutlineCopy size={14} />
                </button>
              </div>
            </div>

            {/* Desktop */}
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <TbOutlineDeviceLaptop size={24} class="text-primary" />
                </div>
                <h3 class="card-title">{t("landing.install.desktop")}</h3>
                <p class="text-base-content/60 text-sm">
                  {t("landing.install.desktopDesc")}
                </p>
                <a
                  href="https://github.com/sternelee/sendme-app/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-primary btn-outline btn-sm mt-4"
                >
                  {t("landing.install.desktopAction")}
                </a>
              </div>
            </div>

            {/* Mobile */}
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <div class="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center mb-4">
                  <TbOutlineDeviceMobile size={24} class="text-warning" />
                </div>
                <h3 class="card-title">{t("landing.install.mobile")}</h3>
                <p class="text-base-content/60 text-sm">
                  {t("landing.install.mobileDesc")}
                </p>
                <a
                  href="https://github.com/sternelee/sendme-app/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-warning btn-outline btn-sm mt-4"
                >
                  {t("landing.install.mobileAction")}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section class="bg-base-200 py-24">
        <div class="container mx-auto px-4">
          <div class="text-center mb-16">
            <h2 class="text-3xl md:text-4xl font-bold mb-4">
              {t("landing.howItWorks.title")}
            </h2>
            <p class="text-base-content/60 max-w-xl mx-auto">
              {t("landing.howItWorks.subtitle")}
            </p>
          </div>

          <div class="max-w-4xl mx-auto space-y-8">
            {[
              {
                icon: TbOutlineUpload,
                title: t("landing.howItWorks.step1Title"),
                description: t("landing.howItWorks.step1Desc"),
                step: "01",
              },
              {
                icon: TbOutlineSparkles,
                title: t("landing.howItWorks.step2Title"),
                description: t("landing.howItWorks.step2Desc"),
                step: "02",
              },
              {
                icon: TbOutlineDownload,
                title: t("landing.howItWorks.step3Title"),
                description: t("landing.howItWorks.step3Desc"),
                step: "03",
              },
            ].map((item, index) => (
              <Motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.15 }}
                class="flex items-start gap-6"
                key={item.step}
              >
                <div class="w-16 h-16 rounded-2xl bg-primary text-primary-content flex items-center justify-center flex-shrink-0">
                  <item.icon size={28} />
                </div>
                <div class="pt-2">
                  <span class="text-sm font-mono text-primary mb-1 block">
                    {item.step}
                  </span>
                  <h3 class="text-xl font-bold mb-2">{item.title}</h3>
                  <p class="text-base-content/60">{item.description}</p>
                </div>
              </Motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section class="py-24">
        <div class="container mx-auto px-4">
          <div class="card bg-base-200 shadow-xl max-w-4xl mx-auto">
            <div class="card-body items-center text-center py-16">
              <h2 class="card-title text-3xl mb-4">{t("landing.cta.title")}</h2>
              <p class="text-base-content/60 mb-8 max-w-xl">
                {t("landing.cta.subtitle")}
              </p>
              <a href="/app" class="btn btn-primary btn-lg gap-2">
                {t("landing.cta.action")}
                <TbOutlineArrowRight size={20} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer class="bg-base-300 py-12">
        <div class="container mx-auto px-6">
          <div class="flex flex-col md:flex-row items-center justify-between gap-6">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-primary text-primary-content flex items-center justify-center">
                <TbOutlineSparkles size={18} />
              </div>
              <span class="text-base-content/60 text-sm">
                {t("common.poweredBy")}{" "}
                <a
                  href="https://iroh.computer"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="link link-primary"
                >
                  iroh.computer
                </a>
              </span>
            </div>
            <div class="flex items-center gap-6 text-sm">
              <a
                href="https://github.com/sternelee/sendme-app"
                target="_blank"
                rel="noopener noreferrer"
                class="link"
              >
                {t("landing.footer.github")}
              </a>
              <a href="/about" class="link">
                {t("landing.footer.about")}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

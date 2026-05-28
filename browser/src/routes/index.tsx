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
  TbOutlineLock,
  TbOutlineRocket,
  TbOutlineGitBranch,
  TbOutlineCheck,
  TbOutlineX,
  TbOutlineArrowUp,
  TbOutlineArrowDown,
  TbOutlineQrcode,
} from "solid-icons/tb";
import { ThemeSwitcher, LanguageSwitcher } from "@sendme/ui";
import { i18n } from "@sendme/shared";

const t = i18n.t;

function TerminalDemo() {
  const lines = [
    { text: "$ cargo install sendme", type: "prompt" as const },
    { text: "    Updating crates.io index", type: "output" as const },
    { text: "   Compiling sendme v0.31.0", type: "output" as const },
    { text: "    Finished release [optimized]", type: "output" as const },
    { text: "$ sendme send photo.jpg", type: "prompt" as const },
    { text: "importing photo.jpg ...", type: "output" as const },
    { text: "to get this data, use:", type: "output" as const },
    { text: "sendme receive blobttc3r3gy4...", type: "ticket" as const },
  ];

  return (
    <div class="rounded-2xl bg-[#1a1b26] border border-[#24283b] overflow-hidden shadow-2xl">
      <div class="flex items-center gap-1.5 px-4 py-3 border-b border-[#24283b]">
        <div class="w-3 h-3 rounded-full bg-[#f7768e]" />
        <div class="w-3 h-3 rounded-full bg-[#e0af68]" />
        <div class="w-3 h-3 rounded-full bg-[#9ece6a]" />
        <span class="ml-3 text-xs text-[#565f89] font-mono">sendme — zsh</span>
      </div>
      <div class="p-4 font-mono text-sm space-y-1">
        {lines.map((line, i) => (
          <Motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.12 }}
          >
            {line.type === "prompt" && (
              <span class="text-[#7aa2f7]">{line.text}</span>
            )}
            {line.type === "output" && (
              <span class="text-[#a9b1d6]">{line.text}</span>
            )}
            {line.type === "ticket" && (
              <span class="text-[#9ece6a]">{line.text}</span>
            )}
          </Motion.div>
        ))}
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ delay: 1.2, duration: 1, repeat: Infinity }}
          class="inline-block w-2 h-4 bg-[#7aa2f7] ml-0 align-middle"
        />
      </div>
    </div>
  );
}

function HeroMockup() {
  return (
    <div class="relative">
      {/* Background glow */}
      <div class="absolute -inset-4 bg-primary/20 rounded-[2rem] blur-3xl opacity-60" />

      {/* Mockup card */}
      <div class="relative surface-card p-5 max-w-sm mx-auto">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <TbOutlineSparkles size={20} class="text-primary" />
          </div>
          <div>
            <p class="font-semibold text-sm">Sendme</p>
            <p class="text-xs text-base-content/50">P2P File Transfer</p>
          </div>
          <span class="ml-auto badge badge-primary badge-xs gap-1">
            <span class="w-1 h-1 rounded-full bg-primary-content animate-pulse" />
            Live
          </span>
        </div>

        {/* Drop zone mockup */}
        <div class="border-2 border-dashed border-base-300/60 rounded-2xl p-6 text-center mb-4">
          <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
            <TbOutlineUpload size={20} class="text-primary/60" />
          </div>
          <p class="text-sm font-medium">Drop file here</p>
          <p class="text-xs text-base-content/50">or click to browse</p>
        </div>

        {/* Ticket mockup */}
        <div class="bg-base-200/60 rounded-xl p-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium">Ticket Ready</span>
            <div class="flex gap-1">
              <TbOutlineQrcode size={12} class="text-base-content/40" />
              <TbOutlineCopy size={12} class="text-base-content/40" />
            </div>
          </div>
          <code class="text-[10px] text-base-content/60 block truncate font-mono">
            blobttc3r3gy4gcswl5qkfj7qrhk3x3v...
          </code>
        </div>
      </div>
    </div>
  );
}

function ComparisonTable() {
  const features = [
    { name: "End-to-end encrypted", sendme: true, wetransfer: false, drive: false },
    { name: "No file size limits", sendme: true, wetransfer: false, drive: true },
    { name: "No account required", sendme: true, wetransfer: false, drive: false },
    { name: "Direct P2P (no servers)", sendme: true, wetransfer: false, drive: false },
    { name: "Open source", sendme: true, wetransfer: false, drive: false },
    { name: "Cross-platform", sendme: true, wetransfer: true, drive: true },
  ];

  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-base-300">
            <th class="text-left py-3 px-4 font-medium text-base-content/60">Feature</th>
            <th class="text-center py-3 px-4">
              <div class="flex items-center justify-center gap-1.5">
                <div class="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
                  <TbOutlineSparkles size={12} class="text-primary" />
                </div>
                <span class="font-semibold text-primary">Sendme</span>
              </div>
            </th>
            <th class="text-center py-3 px-4 font-medium text-base-content/60">WeTransfer</th>
            <th class="text-center py-3 px-4 font-medium text-base-content/60">Cloud Drive</th>
          </tr>
        </thead>
        <tbody>
          {features.map((f) => (
            <tr class="border-b border-base-200/60">
              <td class="py-3 px-4">{f.name}</td>
              <td class="text-center py-3 px-4">
                <TbOutlineCheck size={18} class="text-success mx-auto" />
              </td>
              <td class="text-center py-3 px-4">
                {f.wetransfer ? (
                  <TbOutlineCheck size={18} class="text-success mx-auto" />
                ) : (
                  <TbOutlineX size={18} class="text-error/50 mx-auto" />
                )}
              </td>
              <td class="text-center py-3 px-4">
                {f.drive ? (
                  <TbOutlineCheck size={18} class="text-success mx-auto" />
                ) : (
                  <TbOutlineX size={18} class="text-error/50 mx-auto" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
      <header class="navbar bg-base-100/80 backdrop-blur-xl border-b border-base-300 sticky top-0 z-50 px-6">
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
            <Show when={!auth.isSignedIn()}>
              <a href="/auth/sign-in" class="btn btn-ghost btn-sm">
                {t("landing.menu.signIn")}
              </a>
            </Show>
            <a href="/app" class="btn btn-primary btn-sm gap-2">
              <TbOutlineRocket size={16} />
              {t("landing.getStarted")}
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section class="relative overflow-hidden">
        {/* Background decoration */}
        <div class="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <div class="absolute top-20 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div class="absolute bottom-0 left-0 w-72 h-72 bg-secondary/10 rounded-full blur-3xl pointer-events-none" />

        <div class="container mx-auto px-4 py-20 md:py-28 relative">
          <div class="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
            {/* Left: Text */}
            <Motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
                <span class="w-2 h-2 rounded-full bg-primary animate-pulse" />
                {t("landing.hero.badge") || "P2P File Transfer"}
              </div>
              <h1 class="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                <span class="text-base-content">
                  {t("landing.hero.titleLine1")}
                </span>
                <br />
                <span class="text-primary">{t("landing.hero.titleLine2")}</span>
              </h1>
              <p class="text-lg text-base-content/60 mb-8 max-w-lg">
                {t("landing.hero.subtitle")}
              </p>
              <div class="flex flex-col sm:flex-row items-start gap-3">
                <a href="/app" class="btn btn-primary btn-lg gap-2 rounded-xl">
                  <TbOutlineRocket size={20} />
                  {t("landing.getStarted")}
                </a>
                <a
                  href="https://github.com/sternelee/sendme-app"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-outline btn-lg gap-2 rounded-xl"
                >
                  <TbOutlineGitBranch size={20} />
                  {t("landing.viewOnGithub")}
                </a>
              </div>

              {/* Trust badges */}
              <div class="mt-8 flex items-center gap-4 text-sm text-base-content/50">
                <div class="flex items-center gap-1.5">
                  <TbOutlineLock size={14} />
                  <span>End-to-end encrypted</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <TbOutlineBolt size={14} />
                  <span>No size limits</span>
                </div>
              </div>
            </Motion.div>

            {/* Right: Mockup */}
            <Motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              class="hidden lg:block"
            >
              <HeroMockup />
            </Motion.div>
          </div>
        </div>
      </section>

      {/* CLI Demo Section */}
      <section class="bg-base-200 py-20">
        <div class="container mx-auto px-4">
          <div class="max-w-5xl mx-auto">
            <div class="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <p class="section-label mb-4">{t("landing.install.cli") || "Command Line"}</p>
                <h2 class="text-3xl md:text-4xl font-bold mb-4">
                  Transfer from your terminal
                </h2>
                <p class="text-base-content/60 mb-6">
                  No GUI needed. Send files directly from the command line with a single command.
                  The recipient gets a ticket string — paste it to receive. That's it.
                </p>
                <div class="space-y-3">
                  <div class="flex items-start gap-3">
                    <div class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <TbOutlineArrowUp size={12} class="text-primary" />
                    </div>
                    <p class="text-sm text-base-content/70">
                      <code class="bg-base-300/60 px-1.5 py-0.5 rounded text-xs">sendme send &lt;file&gt;</code> to generate a ticket
                    </p>
                  </div>
                  <div class="flex items-start gap-3">
                    <div class="w-6 h-6 rounded-full bg-secondary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <TbOutlineArrowDown size={12} class="text-secondary" />
                    </div>
                    <p class="text-sm text-base-content/70">
                      <code class="bg-base-300/60 px-1.5 py-0.5 rounded text-xs">sendme receive &lt;ticket&gt;</code> to download
                    </p>
                  </div>
                </div>
              </div>
              <TerminalDemo />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section class="py-20">
        <div class="container mx-auto px-4">
          <div class="text-center mb-14">
            <p class="section-label mb-3">{t("landing.features.title")}</p>
            <h2 class="text-3xl md:text-4xl font-bold mb-4">
              Built for speed and privacy
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
                color: "success",
              },
              {
                icon: TbOutlineBolt,
                title: t("landing.features.fastTitle"),
                description: t("landing.features.fastDesc"),
                color: "warning",
              },
              {
                icon: TbOutlineUsers,
                title: t("landing.features.syncTitle"),
                description: t("landing.features.syncDesc"),
                color: "info",
              },
            ].map((feature) => (
              <div class="surface-card p-6" key={feature.title}>
                <div class={`w-12 h-12 rounded-2xl bg-${feature.color}/10 flex items-center justify-center mb-4`}>
                  <feature.icon size={24} class={`text-${feature.color}`} />
                </div>
                <h3 class="font-semibold text-lg mb-2">{feature.title}</h3>
                <p class="text-base-content/60 text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section class="bg-base-200 py-20">
        <div class="container mx-auto px-4">
          <div class="max-w-3xl mx-auto">
            <div class="text-center mb-10">
              <p class="section-label mb-3">Why Sendme?</p>
              <h2 class="text-3xl md:text-4xl font-bold mb-4">
                No middleman. No limits.
              </h2>
              <p class="text-base-content/60">
                Traditional file sharing services store your files on their servers.
                Sendme transfers directly between devices.
              </p>
            </div>
            <div class="surface-card p-1">
              <ComparisonTable />
            </div>
          </div>
        </div>
      </section>

      {/* Installation Section */}
      <section class="py-20">
        <div class="container mx-auto px-4">
          <div class="text-center mb-14">
            <p class="section-label mb-3">{t("landing.install.title")}</p>
            <h2 class="text-3xl md:text-4xl font-bold mb-4">
              Use it everywhere
            </h2>
            <p class="text-base-content/60 max-w-xl mx-auto">
              {t("landing.install.subtitle")}
            </p>
          </div>

          <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
            {/* Web */}
            <div class="surface-card p-5 text-center">
              <div class="w-12 h-12 rounded-2xl bg-info/10 flex items-center justify-center mx-auto mb-4">
                <TbOutlineWorld size={24} class="text-info" />
              </div>
              <h3 class="font-semibold mb-1">{t("landing.install.webApp")}</h3>
              <p class="text-sm text-base-content/60 mb-4">
                {t("landing.install.webAppDesc")}
              </p>
              <a href="/app" class="btn btn-info btn-outline btn-sm rounded-xl w-full">
                {t("landing.install.webAppAction")}
              </a>
            </div>

            {/* CLI */}
            <div class="surface-card p-5 text-center">
              <div class="w-12 h-12 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
                <TbOutlineTerminal size={24} class="text-success" />
              </div>
              <h3 class="font-semibold mb-1">{t("landing.install.cli")}</h3>
              <p class="text-sm text-base-content/60 mb-4">
                {t("landing.install.cliDesc")}
              </p>
              <button
                type="button"
                class="btn btn-outline btn-sm rounded-xl w-full font-mono"
                onClick={() => copyToClipboard("cargo install sendme")}
              >
                <TbOutlineCopy size={14} />
                cargo install
              </button>
            </div>

            {/* Desktop */}
            <div class="surface-card p-5 text-center">
              <div class="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <TbOutlineDeviceLaptop size={24} class="text-primary" />
              </div>
              <h3 class="font-semibold mb-1">{t("landing.install.desktop")}</h3>
              <p class="text-sm text-base-content/60 mb-4">
                {t("landing.install.desktopDesc")}
              </p>
              <a
                href="https://github.com/sternelee/sendme-app/releases"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-primary btn-outline btn-sm rounded-xl w-full"
              >
                {t("landing.install.desktopAction")}
              </a>
            </div>

            {/* Mobile */}
            <div class="surface-card p-5 text-center">
              <div class="w-12 h-12 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-4">
                <TbOutlineDeviceMobile size={24} class="text-warning" />
              </div>
              <h3 class="font-semibold mb-1">{t("landing.install.mobile")}</h3>
              <p class="text-sm text-base-content/60 mb-4">
                {t("landing.install.mobileDesc")}
              </p>
              <a
                href="https://github.com/sternelee/sendme-app/releases"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-warning btn-outline btn-sm rounded-xl w-full"
              >
                {t("landing.install.mobileAction")}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section class="bg-base-200 py-20">
        <div class="container mx-auto px-4">
          <div class="text-center mb-14">
            <p class="section-label mb-3">{t("landing.howItWorks.title")}</p>
            <h2 class="text-3xl md:text-4xl font-bold mb-4">
              Three steps to any file
            </h2>
            <p class="text-base-content/60 max-w-xl mx-auto">
              {t("landing.howItWorks.subtitle")}
            </p>
          </div>

          <div class="max-w-3xl mx-auto">
            <div class="relative">
              {/* Connecting line */}
              <div class="absolute left-8 top-12 bottom-12 w-px bg-gradient-to-b from-primary via-secondary to-primary hidden md:block" />

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
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.15 }}
                  class="flex items-start gap-6 mb-8 last:mb-0 relative"
                  key={item.step}
                >
                  <div class="w-16 h-16 rounded-2xl bg-primary text-primary-content flex items-center justify-center flex-shrink-0 z-10 shadow-lg shadow-primary/20">
                    <item.icon size={28} />
                  </div>
                  <div class="pt-2 pb-2">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-xs font-mono text-primary font-semibold">
                        Step {item.step}
                      </span>
                    </div>
                    <h3 class="text-xl font-bold mb-2">{item.title}</h3>
                    <p class="text-base-content/60">{item.description}</p>
                  </div>
                </Motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section class="py-20">
        <div class="container mx-auto px-4">
          <div class="surface-card p-8 md:p-12 max-w-4xl mx-auto text-center relative overflow-hidden">
            {/* Background decoration */}
            <div class="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div class="absolute bottom-0 left-0 w-48 h-48 bg-secondary/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div class="relative">
              <h2 class="text-3xl md:text-4xl font-bold mb-4">{t("landing.cta.title")}</h2>
              <p class="text-base-content/60 mb-8 max-w-xl mx-auto">
                {t("landing.cta.subtitle")}
              </p>
              <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
                <a href="/app" class="btn btn-primary btn-lg gap-2 rounded-xl">
                  {t("landing.cta.action")}
                  <TbOutlineArrowRight size={20} />
                </a>
                <a
                  href="https://github.com/sternelee/sendme-app"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-outline btn-lg gap-2 rounded-xl"
                >
                  <TbOutlineGitBranch size={20} />
                  Star on GitHub
                </a>
              </div>
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

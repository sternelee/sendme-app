import { Motion } from "solid-motionone";
import { createSignal, Show } from "solid-js";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "clerk-solidjs";
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
import { ThemeSwitcher } from "~/lib/ThemeSwitcher";

export default function HomePage() {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
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
            <ThemeSwitcher />
            <div class="dropdown dropdown-end relative">
              <div
                tabindex="0"
                role="button"
                class="btn btn-ghost btn-sm cursor-pointer"
              >
                Menu
              </div>
              <ul
                tabindex="-1"
                class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-42 border border-base-200 absolute right-0 mt-2"
              >
                <SignedOut>
                  <li>
                    <a href="/app" class="font-bold">
                      Launch App
                    </a>
                  </li>
                  <li>
                    <SignInButton mode="modal">Sign In</SignInButton>
                  </li>
                  <li>
                    <SignUpButton mode="modal">Sign Up</SignUpButton>
                  </li>
                </SignedOut>
                <SignedIn>
                  <li>
                    <a href="/app" class="font-bold">
                      Go to App
                    </a>
                  </li>
                </SignedIn>
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
              P2P File Transfer
            </div>
            <h1 class="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              <span class="text-base-content">Send Files</span>
              <br />
              <span class="text-primary">Without Limits</span>
            </h1>
            <p class="text-lg md:text-xl text-base-content/60 mb-10 max-w-2xl mx-auto">
              Secure, peer-to-peer file transfer powered by iroh. No cloud
              storage, no file size limits, just direct transfers between
              devices.
            </p>
            <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a href="/app" class="btn btn-primary btn-lg gap-2">
                <TbOutlineSparkles size={20} />
                Get Started Free
              </a>
              <a
                href="https://github.com/sternelee/sendme-app"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-outline btn-lg gap-2"
              >
                <TbOutlineTerminal size={20} />
                View on GitHub
              </a>
            </div>
          </Motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section class="bg-base-200 py-24">
        <div class="container mx-auto px-4">
          <div class="text-center mb-16">
            <h2 class="text-3xl md:text-4xl font-bold mb-4">Why Sendme?</h2>
            <p class="text-base-content/60 max-w-xl mx-auto">
              Fast, secure, and private file transfer built for the modern web
            </p>
          </div>

          <div class="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                icon: TbOutlineShield,
                title: "End-to-End Encrypted",
                description:
                  "BLAKE3 verified streaming ensures your files arrive intact and untouched.",
              },
              {
                icon: TbOutlineBolt,
                title: "Lightning Fast",
                description:
                  "Direct P2P transfers with NAT hole-punching for maximum speed.",
              },
              {
                icon: TbOutlineUsers,
                title: "Cross-Device Sync",
                description:
                  "Share tickets across your devices and continue transfers anywhere.",
              },
            ].map((feature) => (
              <div class="card bg-base-100 shadow-lg">
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
            <h2 class="text-3xl md:text-4xl font-bold mb-4">Install Sendme</h2>
            <p class="text-base-content/60 max-w-xl mx-auto">
              Choose your platform and start transferring files today
            </p>
          </div>

          <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {/* Web */}
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <div class="w-12 h-12 rounded-xl bg-info/10 flex items-center justify-center mb-4">
                  <TbOutlineWorld size={24} class="text-info" />
                </div>
                <h3 class="card-title">Web App</h3>
                <p class="text-base-content/60 text-sm">
                  No installation required
                </p>
                <a href="/app" class="btn btn-info btn-outline btn-sm mt-4">
                  Launch App
                </a>
              </div>
            </div>

            {/* CLI */}
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <div class="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center mb-4">
                  <TbOutlineTerminal size={24} class="text-success" />
                </div>
                <h3 class="card-title">CLI</h3>
                <p class="text-base-content/60 text-sm">For power users</p>
                <button
                  type="button"
                  class="btn btn-outline btn-sm mt-4 font-mono"
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
                <h3 class="card-title">Desktop</h3>
                <p class="text-base-content/60 text-sm">
                  macOS, Windows, Linux
                </p>
                <a
                  href="https://github.com/sternelee/sendme-app/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-primary btn-outline btn-sm mt-4"
                >
                  Download
                </a>
              </div>
            </div>

            {/* Mobile */}
            <div class="card bg-base-200">
              <div class="card-body items-center text-center">
                <div class="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center mb-4">
                  <TbOutlineDeviceMobile size={24} class="text-warning" />
                </div>
                <h3 class="card-title">Mobile</h3>
                <p class="text-base-content/60 text-sm">iOS & Android</p>
                <a
                  href="https://github.com/sternelee/sendme-app/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-warning btn-outline btn-sm mt-4"
                >
                  Get App
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
            <h2 class="text-3xl md:text-4xl font-bold mb-4">How It Works</h2>
            <p class="text-base-content/60 max-w-xl mx-auto">
              Three simple steps to secure file transfer
            </p>
          </div>

          <div class="max-w-4xl mx-auto space-y-8">
            {[
              {
                icon: TbOutlineUpload,
                title: "Select Your File",
                description:
                  "Choose any file or folder from your device. No size restrictions apply.",
                step: "01",
              },
              {
                icon: TbOutlineSparkles,
                title: "Generate Ticket",
                description:
                  "A unique ticket is created containing connection details for direct P2P transfer.",
                step: "02",
              },
              {
                icon: TbOutlineDownload,
                title: "Share & Receive",
                description:
                  "Share the ticket with the recipient. They paste it to start the download instantly.",
                step: "03",
              },
            ].map((item, index) => (
              <Motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.15 }}
                class="flex items-start gap-6"
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
              <h2 class="card-title text-3xl mb-4">Ready to Transfer?</h2>
              <p class="text-base-content/60 mb-8 max-w-xl">
                Join thousands of users sending files securely with Sendme
              </p>
              <a href="/app" class="btn btn-primary btn-lg gap-2">
                Launch Sendme
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
                Powered by{" "}
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
                GitHub
              </a>
              <a href="/about" class="link">
                About
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

import { Motion } from "solid-motionone";
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

export default function HomePage() {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div class="min-h-screen bg-animate text-white selection:bg-purple-500/30 overflow-hidden">
      {/* Dynamic Background */}
      <div class="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] animate-pulse" />
        <div class="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/20 rounded-full blur-[120px] animate-pulse" style="animation-delay: 1s" />
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_center,transparent_0%,rgba(18,14,38,0.4)_100%)]" />
      </div>

      {/* Header */}
      <header class="relative z-20 border-b border-white/5 backdrop-blur-md bg-black/10">
        <div class="container mx-auto px-6 py-4 flex items-center justify-between">
          <Motion.a
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            hover={{ scale: 1.05 }}
            press={{ scale: 0.95 }}
            class="flex items-center gap-3 group"
            href="/"
          >
            <div class="w-10 h-10 rounded-xl bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-all">
              <TbOutlineSparkles size={22} class="text-white" />
            </div>
            <span class="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
              Sendmd
            </span>
          </Motion.a>

          <Motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            class="flex items-center gap-4"
          >
            <Motion.a
              hover={{ scale: 1.05 }}
              press={{ scale: 0.95 }}
              href="/app"
              class="px-6 py-2.5 rounded-xl bg-white/10 border border-white/10 text-white/90 hover:text-white hover:bg-white/15 transition-all font-medium"
            >
              Launch App
            </Motion.a>
          </Motion.div>
        </div>
      </header>

      {/* Hero Section */}
      <section class="relative z-10 container mx-auto px-4 py-24 md:py-32">
        <div class="max-w-4xl mx-auto text-center">
          <Motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 mb-8">
              <span class="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              <span class="text-sm text-purple-300">P2P File Transfer</span>
            </div>
            <h1 class="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              <span class="bg-clip-text text-transparent bg-gradient-to-r from-white via-purple-100 to-indigo-200">
                Send Files
              </span>
              <br />
              <span class="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">
                Without Limits
              </span>
            </h1>
            <p class="text-lg md:text-xl text-white/60 mb-10 max-w-2xl mx-auto leading-relaxed">
              Secure, peer-to-peer file transfer powered by iroh. No cloud storage,
              no file size limits, just direct transfers between devices.
            </p>
            <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Motion.a
                hover={{ scale: 1.05, backgroundColor: "rgb(168, 85, 247)" }}
                press={{ scale: 0.95 }}
                href="/app"
                class="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold shadow-lg shadow-purple-500/30 flex items-center justify-center gap-2"
              >
                <TbOutlineSparkles size={20} />
                Get Started Free
              </Motion.a>
              <Motion.a
                hover={{ scale: 1.05, backgroundColor: "rgba(255, 255, 255, 0.15)" }}
                press={{ scale: 0.95 }}
                href="https://github.com/n0kosec/iroh-sendmd"
                target="_blank"
                rel="noopener noreferrer"
                class="w-full sm:w-auto px-8 py-4 rounded-xl bg-white/10 border border-white/10 text-white font-semibold flex items-center justify-center gap-2"
              >
                <TbOutlineTerminal size={20} />
                View on GitHub
              </Motion.a>
            </div>
          </Motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section class="relative z-10 container mx-auto px-4 py-24">
        <Motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          class="text-center mb-16"
        >
          <h2 class="text-3xl md:text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
            Why Sendmd?
          </h2>
          <p class="text-white/50 max-w-xl mx-auto">
            Fast, secure, and private file transfer built for the modern web
          </p>
        </Motion.div>

        <div class="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {[
            {
              icon: TbOutlineShield,
              title: "End-to-End Encrypted",
              description: "BLAKE3 verified streaming ensures your files arrive intact and untouched.",
            },
            {
              icon: TbOutlineBolt,
              title: "Lightning Fast",
              description: "Direct P2P transfers with NAT hole-punching for maximum speed.",
            },
            {
              icon: TbOutlineUsers,
              title: "Cross-Device Sync",
              description: "Share tickets across your devices and continue transfers anywhere.",
            },
          ].map((feature, index) => (
            <Motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              hover={{ y: -5 }}
              class="glass rounded-2xl p-8 group"
            >
              <div class="w-14 h-14 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-6 group-hover:bg-purple-500/20 transition-all">
                <feature.icon size={28} class="text-purple-400" />
              </div>
              <h3 class="text-xl font-semibold mb-3">{feature.title}</h3>
              <p class="text-white/50 leading-relaxed">{feature.description}</p>
            </Motion.div>
          ))}
        </div>
      </section>

      {/* Installation Section */}
      <section class="relative z-10 container mx-auto px-4 py-24">
        <Motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          class="text-center mb-16"
        >
          <h2 class="text-3xl md:text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
            Install Sendmd
          </h2>
          <p class="text-white/50 max-w-xl mx-auto">
            Choose your platform and start transferring files today
          </p>
        </Motion.div>

        <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {/* Web */}
          <Motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            hover={{ y: -5 }}
            class="glass rounded-2xl p-6 group"
          >
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/20 flex items-center justify-center mb-4">
              <TbOutlineWorld size={24} class="text-blue-400" />
            </div>
            <h3 class="text-lg font-semibold mb-2">Web App</h3>
            <p class="text-white/50 text-sm mb-4">No installation required</p>
            <Motion.a
              hover={{ scale: 1.02 }}
              press={{ scale: 0.98 }}
              href="/app"
              class="block w-full px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium text-center hover:bg-blue-500/20 transition-all"
            >
              Launch App
            </Motion.a>
          </Motion.div>

          {/* CLI */}
          <Motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            hover={{ y: -5 }}
            class="glass rounded-2xl p-6 group"
          >
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/20 flex items-center justify-center mb-4">
              <TbOutlineTerminal size={24} class="text-green-400" />
            </div>
            <h3 class="text-lg font-semibold mb-2">CLI</h3>
            <p class="text-white/50 text-sm mb-4">For power users</p>
            <div
              class="bg-black/30 rounded-lg p-3 mb-3 font-mono text-xs text-white/70 cursor-pointer hover:bg-black/40 transition-all flex items-center justify-between group/command"
              onClick={() => copyToClipboard("cargo install sendmd")}
            >
              <span>$ cargo install sendmd</span>
              <TbOutlineCopy size={14} class="text-white/40 group-hover/command:text-white/70" />
            </div>
          </Motion.div>

          {/* Desktop */}
          <Motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            hover={{ y: -5 }}
            class="glass rounded-2xl p-6 group"
          >
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/20 flex items-center justify-center mb-4">
              <TbOutlineDeviceLaptop size={24} class="text-purple-400" />
            </div>
            <h3 class="text-lg font-semibold mb-2">Desktop</h3>
            <p class="text-white/50 text-sm mb-4">macOS, Windows, Linux</p>
            <Motion.a
              hover={{ scale: 1.02 }}
              press={{ scale: 0.98 }}
              href="https://github.com/n0kosec/iroh-sendmd/releases"
              target="_blank"
              rel="noopener noreferrer"
              class="block w-full px-4 py-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm font-medium text-center hover:bg-purple-500/20 transition-all"
            >
              Download
            </Motion.a>
          </Motion.div>

          {/* Mobile */}
          <Motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            hover={{ y: -5 }}
            class="glass rounded-2xl p-6 group"
          >
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 border border-orange-500/20 flex items-center justify-center mb-4">
              <TbOutlineDeviceMobile size={24} class="text-orange-400" />
            </div>
            <h3 class="text-lg font-semibold mb-2">Mobile</h3>
            <p class="text-white/50 text-sm mb-4">iOS & Android</p>
            <Motion.a
              hover={{ scale: 1.02 }}
              press={{ scale: 0.98 }}
              href="https://github.com/n0kosec/iroh-sendmd/releases"
              target="_blank"
              rel="noopener noreferrer"
              class="block w-full px-4 py-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-300 text-sm font-medium text-center hover:bg-orange-500/20 transition-all"
            >
              Get App
            </Motion.a>
          </Motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section class="relative z-10 container mx-auto px-4 py-24">
        <Motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          class="text-center mb-16"
        >
          <h2 class="text-3xl md:text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
            How It Works
          </h2>
          <p class="text-white/50 max-w-xl mx-auto">
            Three simple steps to secure file transfer
          </p>
        </Motion.div>

        <div class="max-w-4xl mx-auto">
          <div class="relative">
            {/* Connection Line */}
            <div class="absolute left-8 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-purple-500/50 via-indigo-500/50 to-transparent hidden md:block" />

            {[
              {
                icon: TbOutlineUpload,
                title: "Select Your File",
                description: "Choose any file or folder from your device. No size restrictions apply.",
                step: "01",
              },
              {
                icon: TbOutlineSparkles,
                title: "Generate Ticket",
                description: "A unique ticket is created containing connection details for direct P2P transfer.",
                step: "02",
              },
              {
                icon: TbOutlineDownload,
                title: "Share & Receive",
                description: "Share the ticket with the recipient. They paste it to start the download instantly.",
                step: "03",
              },
            ].map((item, index) => (
              <Motion.div
                initial={{ opacity: 0, x: index % 2 === 0 ? -30 : 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.15 }}
                class="flex flex-col md:flex-row items-start md:items-center gap-6 mb-16 last:mb-0"
              >
                <div class="flex items-center gap-6 flex-1">
                  <div class="relative z-10 w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30 flex-shrink-0">
                    <item.icon size={28} class="text-white" />
                  </div>
                  <div>
                    <span class="text-sm text-purple-400 font-mono mb-1 block">
                      {item.step}
                    </span>
                    <h3 class="text-xl font-semibold mb-2">{item.title}</h3>
                    <p class="text-white/50">{item.description}</p>
                  </div>
                </div>
              </Motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section class="relative z-10 container mx-auto px-4 py-24">
        <Motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          class="glass rounded-3xl p-12 md:p-16 text-center max-w-4xl mx-auto"
        >
          <h2 class="text-3xl md:text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
            Ready to Transfer?
          </h2>
          <p class="text-white/50 mb-8 max-w-xl mx-auto">
            Join thousands of users sending files securely with Sendmd
          </p>
          <Motion.a
            hover={{ scale: 1.05, backgroundColor: "rgb(168, 85, 247)" }}
            press={{ scale: 0.95 }}
            href="/app"
            class="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold shadow-lg shadow-purple-500/30"
          >
            Launch Sendmd
            <TbOutlineArrowRight size={20} />
          </Motion.a>
        </Motion.div>
      </section>

      {/* Footer */}
      <footer class="relative z-10 border-t border-white/5">
        <div class="container mx-auto px-6 py-12">
          <div class="flex flex-col md:flex-row items-center justify-between gap-6">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <TbOutlineSparkles size={18} class="text-white" />
              </div>
              <span class="text-white/60 text-sm">
                Powered by{" "}
                <a
                  href="https://iroh.computer"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-purple-400/80 hover:text-purple-300 transition-colors font-medium"
                >
                  iroh.computer
                </a>
              </span>
            </div>
            <div class="flex items-center gap-6 text-sm text-white/40">
              <a
                href="https://github.com/n0kosec/iroh-sendmd"
                target="_blank"
                rel="noopener noreferrer"
                class="hover:text-white/60 transition-colors"
              >
                GitHub
              </a>
              <a
                href="/about"
                class="hover:text-white/60 transition-colors"
              >
                About
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * PWA Install Prompt Component
 * Shows a prompt to install the app as a PWA when available
 */

import { createSignal, Show, onMount } from "solid-js";
import { Motion, Presence } from "solid-motionone";
import { TbOutlineDownload, TbOutlineX } from "solid-icons/tb";
import toast from "solid-toast";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    createSignal<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = createSignal(false);

  onMount(() => {
    const handler = (e: Event) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show the prompt after a short delay
      setTimeout(() => setShowPrompt(true), 2000);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Check if app is already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setShowPrompt(false);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  });

  const handleInstall = async () => {
    const prompt = deferredPrompt();
    if (!prompt) return;

    // Show the install prompt
    await prompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await prompt.userChoice;

    if (outcome === "accepted") {
      toast.success("App installed successfully!");
    }

    // Clear the saved prompt
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Store in localStorage that user dismissed
    localStorage.setItem("pwa-install-prompt-dismissed", Date.now().toString());
  };

  // Check if user dismissed recently (within 7 days)
  const checkDismissed = () => {
    const dismissed = localStorage.getItem("pwa-install-prompt-dismissed");
    if (dismissed) {
      const daysSinceDismissed =
        (Date.now() - parseInt(dismissed)) / (1000 * 60 * 60 * 24);
      return daysSinceDismissed < 7;
    }
    return false;
  };
  const shouldShow = () =>
    showPrompt() && deferredPrompt() && !checkDismissed();

  return (
    <Presence>
      <Show when={shouldShow()}>
        <Motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 100 }}
          transition={{ duration: 0.3 }}
          class="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50"
        >
          <div class="glass rounded-2xl p-4 shadow-2xl border border-purple-500/20">
            <div class="flex items-start gap-4">
              {/* Icon */}
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/30">
                <svg
                  class="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                  />
                </svg>
              </div>

              {/* Content */}
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-white mb-1">Install Sendmd</h3>
                <p class="text-sm text-white/60">
                  Install the app for faster access and offline support
                </p>
              </div>

              {/* Close button */}
              <button
                onClick={handleDismiss}
                class="flex-shrink-0 w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <TbOutlineX size={16} class="text-white/60" />
              </button>
            </div>

            {/* Install button */}
            <button
              onClick={handleInstall}
              class="w-full mt-4 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2 hover:shadow-purple-500/30 transition-shadow"
            >
              <TbOutlineDownload size={18} />
              Install App
            </button>
          </div>
        </Motion.div>
      </Show>
    </Presence>
  );
}

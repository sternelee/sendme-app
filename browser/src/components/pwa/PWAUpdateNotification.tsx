/**
 * PWA Update Notification Component
 * Shows a notification when a new version of the app is available
 */

import { createSignal, Show, onMount } from "solid-js";
import { Motion, Presence } from "solid-motionone";
import {
  TbOutlineRefresh,
  TbOutlineX,
  TbOutlineDownload,
} from "solid-icons/tb";
import toast from "solid-toast";

export default function PWAUpdateNotification() {
  const [showUpdate, setShowUpdate] = createSignal(false);
  const [isUpdating, setIsUpdating] = createSignal(false);
  const [registration, setRegistration] =
    createSignal<ServiceWorkerRegistration | null>(null);

  onMount(() => {
    const checkForUpdates = () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then((reg) => {
          setRegistration(reg);

          // Check for updates
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (
                  newWorker.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {
                  // New version available
                  setShowUpdate(true);
                }
              });
            }
          });
        });
      }
    };

    // Check periodically for updates
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 60000); // Check every minute

    return () => clearInterval(interval);
  });

  const handleUpdate = async () => {
    setIsUpdating(true);

    try {
      const reg = registration();
      if (reg && reg.waiting) {
        // Tell the waiting service worker to skip waiting
        reg.waiting.postMessage({ type: "SKIP_WAITING" });

        // Wait for the new service worker to become active
        const newWorkerActivated = new Promise<void>((resolve) => {
          reg.addEventListener("controllerchange", () => resolve(), {
            once: true,
          });
        });

        await newWorkerActivated;

        // Reload the page
        window.location.reload();
      }
    } catch (error) {
      console.error("Failed to update app:", error);
      toast.error("Failed to update. Please refresh the page.");
      setIsUpdating(false);
    }
  };

  const handleDismiss = () => {
    setShowUpdate(false);
  };

  return (
    <Presence>
      <Show when={showUpdate()}>
        <Motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          transition={{ duration: 0.3 }}
          class="fixed top-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50"
        >
          <div class="glass rounded-2xl p-4 shadow-2xl border border-green-500/20">
            <div class="flex items-start gap-4">
              {/* Icon */}
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-green-500/30">
                <Show
                  when={isUpdating()}
                  fallback={<TbOutlineDownload size={24} class="text-white" />}
                >
                  <svg
                    class="animate-spin w-6 h-6 text-white"
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
              </div>

              {/* Content */}
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-white mb-1">Update Available</h3>
                <p class="text-sm text-white/60">
                  A new version of Sendmd is ready to install
                </p>
              </div>

              {/* Close button */}
              <button
                onClick={handleDismiss}
                class="flex-shrink-0 w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                disabled={isUpdating()}
              >
                <TbOutlineX size={16} class="text-white/60" />
              </button>
            </div>

            {/* Update button */}
            <button
              onClick={handleUpdate}
              disabled={isUpdating()}
              class="w-full mt-4 px-4 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold shadow-lg shadow-green-500/20 flex items-center justify-center gap-2 hover:shadow-green-500/30 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Show when={isUpdating()} fallback="Update Now">
                Updating...
              </Show>
              <Show when={!isUpdating()}>
                <TbOutlineRefresh size={18} />
                Update Now
              </Show>
            </button>
          </div>
        </Motion.div>
      </Show>
    </Presence>
  );
}

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
          <div class="alert alert-success shadow-lg">
            <div class="flex items-start gap-4">
              {/* Icon */}
              <div class="w-12 h-12 rounded-xl bg-success/20 text-success flex items-center justify-center flex-shrink-0">
                <Show
                  when={isUpdating()}
                  fallback={<TbOutlineDownload size={24} />}
                >
                  <span class="loading loading-spinner loading-sm"></span>
                </Show>
              </div>

              {/* Content */}
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-success-content mb-1">Update Available</h3>
                <p class="text-sm text-success-content/70">
                  A new version of Sendme is ready to install
                </p>
              </div>

              {/* Close button */}
              <button
                onClick={handleDismiss}
                class="btn btn-ghost btn-xs btn-circle"
                disabled={isUpdating()}
              >
                <TbOutlineX size={16} />
              </button>
            </div>

            {/* Update button */}
            <button
              onClick={handleUpdate}
              disabled={isUpdating()}
              class="btn btn-success w-full mt-4"
            >
              <Show when={isUpdating()} fallback="Update Now">
                <span class="loading loading-spinner loading-sm"></span>
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

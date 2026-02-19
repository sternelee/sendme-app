import { createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { platform } from "@tauri-apps/plugin-os";
import { Sparkles, Loader2 } from "lucide-solid";

export default function Home() {
  const navigate = useNavigate();

  onMount(async () => {
    try {
      // Detect platform
      const currentPlatform = await platform();

      // Redirect based on platform
      if (currentPlatform === "android" || currentPlatform === "ios") {
        navigate("/mobile", { replace: true });
      } else {
        navigate("/desktop", { replace: true });
      }
    } catch (e) {
      // Fallback to desktop on error
      console.error("Platform detection failed:", e);
      navigate("/desktop", { replace: true });
    }
  });

  return (
    <div class="flex min-h-screen items-center justify-center bg-[#120e26]">
      <div class="text-center">
        <div class="mb-4 flex items-center justify-center gap-3">
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-purple-500 to-indigo-600 shadow-xl shadow-purple-500/20">
            <Sparkles size={24} class="text-white" />
          </div>
        </div>
        <Loader2 class="mx-auto animate-spin text-purple-400" size={24} />
        <p class="mt-4 text-sm text-white/50">Loading...</p>
      </div>
    </div>
  );
}

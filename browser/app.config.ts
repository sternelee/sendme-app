import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  vite: {
    plugins: [tailwindcss(),
    wasm(),
    topLevelAwait()
    ]
  },

  server: {
    preset: "cloudflare_module",
    compatibilityDate: "2026-01-16"
  }
});

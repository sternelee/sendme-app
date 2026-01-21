import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  vite: {
    plugins: [tailwindcss(), wasm(), topLevelAwait()],
  },

  server: {
    preset: "cloudflare_module",
    compatibilityDate: "2026-01-16",
    // Cloudflare service bindings
    cloudflare: {
      bindings: {
        kv: {
          SESSION_KV: {
            type: "kv_namespace",
            id: process.env.CLOUDFLARE_KV_ID || "YOUR_KV_NAMESPACE_ID",
          },
        },
        d1: {
          DB: {
            type: "d1_database",
            id: process.env.CLOUDFLARE_D1_ID || "YOUR_D1_DATABASE_ID",
          },
        },
      },
    },
  },
});

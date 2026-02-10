import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  vite: {
    plugins: [
      tailwindcss(),
      wasm(),
      topLevelAwait(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "robots.txt", "apple-touch-icon.png"],
        manifest: {
          name: "Sendmd - P2P File Transfer",
          short_name: "Sendmd",
          description:
            "Secure, peer-to-peer file transfer powered by iroh. Send files of any size without cloud storage.",
          theme_color: "#a855f7",
          background_color: "#0c0a1e",
          display: "standalone",
          orientation: "portrait",
          scope: "/",
          start_url: "/",
          icons: [
            {
              src: "/icon-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any maskable",
            },
            {
              src: "/icon-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
            {
              src: "/apple-touch-icon.png",
              sizes: "180x180",
              type: "image/png",
              purpose: "apple touch icon",
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 30 * 1024 * 1024, // 30 MB - allow caching large WASM files
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,wasm}"],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/iroh\.computer\/.*/i,
              handler: "NetworkFirst",
              options: {
                cacheName: "iroh-cache",
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: "module",
        },
      }),
    ],
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

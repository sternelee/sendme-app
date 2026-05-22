import { defineConfig } from "vite";
import { resolve } from "path";
import solid from "vite-plugin-solid";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    target: ["es2020", "safari15", "ios15"],
    cssTarget: "safari15",
  },

  resolve: {
    alias: {
      "~": resolve(__dirname, "./src"),
      "@sendme/ui": resolve(__dirname, "../packages/ui/src/index.ts"),
      "@sendme/shared": resolve(__dirname, "../packages/shared/src/index.ts"),
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/api": {
        target:
          process.env.VITE_BROWSER_API_ORIGIN || "https://sendme.leeapp.dev",
        changeOrigin: true,
        secure: true,
      },
    },
  },
}));

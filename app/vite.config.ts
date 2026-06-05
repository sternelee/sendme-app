import { defineConfig } from "vite";
import { resolve } from "path";
import { readFileSync, writeFileSync } from "fs";
import solid from "vite-plugin-solid";

const host = process.env.TAURI_DEV_HOST;

function inlineTauriEntryAssets() {
  return {
    name: "inline-tauri-entry-assets",
    enforce: "post" as const,
    apply: "build" as const,
    writeBundle(outputOptions) {
      const distDir = resolve(__dirname, outputOptions.dir || "dist");
      const htmlPath = resolve(distDir, "index.html");
      let html = readFileSync(htmlPath, "utf8");

      html = html.replace(
        /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
        (_match, src: string) => {
          const script = readFileSync(
            resolve(distDir, src.replace(/^\//, "")),
            "utf8",
          );
          return `<script type="module">\n${script}\n</script>`;
        },
      );

      html = html.replace(
        /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
        (_match, href: string) => {
          const css = readFileSync(
            resolve(distDir, href.replace(/^\//, "")),
            "utf8",
          );
          return `<style>\n${css}\n</style>`;
        },
      );

      html = html.replace(
        /<link rel="icon" type="image\/svg\+xml" href="\/solid\.svg" \/>/,
        '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E" />',
      );

      writeFileSync(htmlPath, html);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid(), inlineTauriEntryAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    target: ["es2020", "safari15", "ios15"],
    cssTarget: "safari15",
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
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

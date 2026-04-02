import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
// import { VitePWA } from "vite-plugin-pwa";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Rollup plugin that appends the UserDO named export to the worker entry
 * so Cloudflare Workers can bind it as a Durable Object class.
 */
function cloudflareDoExportsPlugin() {
  return {
    name: "inject-durable-object-exports",
    renderChunk(code: string, chunk: { isEntry: boolean }) {
      if (chunk.isEntry) {
        // Import and re-export UserDO so wrangler registers it
        return {
          code:
            `import { UserDO as _UserDO } from ${JSON.stringify(
              resolve(__dirname, "src/worker/durable-objects/user.ts"),
            )};\n` +
            code +
            `\nexport { _UserDO as UserDO };\n`,
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [
      tailwindcss(),
      wasm(),
      topLevelAwait(),
    ],
  },

  server: {
    preset: "cloudflare_module",
    compatibilityDate: "2026-01-16",
    // Expose UserDO class as a named export for the DO binding
    rollupConfig: {
      plugins: [cloudflareDoExportsPlugin()],
    },
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
        durableObjects: {
          USER_DO: {
            className: "UserDO",
            scriptName: undefined, // same worker
          },
        },
      },
    },
  },
});

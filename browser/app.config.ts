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

/**
 * Rollup plugin that bypasses Nitro's h3/node-adapter pipeline for WebSocket
 * upgrade requests to /api/ws. Nitro reconstructs Response objects via
 * `new Response(body, {status, headers})` which drops Cloudflare's special
 * `webSocket` property — breaking the WS handshake with Durable Objects.
 *
 * This plugin modifies the compiled worker entry to intercept WebSocket
 * upgrades and call the /api/ws route handler DIRECTLY, returning its
 * Response (with the `webSocket` property intact) without reconstruction.
 */
function cloudflareWsBypassPlugin() {
  return {
    name: "bypass-h3-for-websocket",
    renderChunk(code: string, chunk: { isEntry: boolean; fileName?: string }) {
      if (!chunk.isEntry) return null;

      // Match the re-export-default pattern emitted by Nitro for cloudflare-module.
      // Rollup may pretty-print between renderChunk plugins, so tolerate spaces and
      // either quote style:
      //   export{<name> as default}from"./chunks/nitro/nitro.mjs";
      //   export { aB as default } from './chunks/nitro/nitro.mjs';
      const match = code.match(/export\s*\{\s*(\w+)\s+as\s+default\s*\}\s*from\s*["']([^"']+)["']\s*;/);
      if (!match) return null;

      const [fullMatch, varName, fromPath] = match;

      // Import the compiled /api/ws GET handler from the route chunk directly.
      // This chunk is always named ws.mjs (no hash) by Nitro's route bundler.
      const wsImport = `import{GET as _wsGet}from"./chunks/build/ws.mjs";`;

      // Convert the re-export into a named import so we can wrap the handler.
      const namedImport = `import{${varName} as _nitroHandler}from"${fromPath}";`;

      // Thin wrapper: intercept /api/ws WebSocket upgrades before h3 sees them.
      // For all other requests, delegate to Nitro's default handler as usual.
      const wrapper = [
        `const _wsWrapped={`,
        `  async fetch(req,env,ctx){`,
        `    const _u=new URL(req.url);`,
        `    if(_u.pathname==="/api/ws"&&(req.headers.get("upgrade")||"").toLowerCase()==="websocket"){`,
        `      return _wsGet({request:req,nativeEvent:{context:{cloudflare:{env}}}});`,
        `    }`,
        `    return _nitroHandler.fetch(req,env,ctx);`,
        `  }`,
        `};`,
        // Forward non-fetch handlers (scheduled, email, queue, tail, trace)
        `if(_nitroHandler.scheduled)_wsWrapped.scheduled=(...a)=>_nitroHandler.scheduled(...a);`,
        `if(_nitroHandler.email)_wsWrapped.email=(...a)=>_nitroHandler.email(...a);`,
        `if(_nitroHandler.queue)_wsWrapped.queue=(...a)=>_nitroHandler.queue(...a);`,
        `if(_nitroHandler.tail)_wsWrapped.tail=(...a)=>_nitroHandler.tail(...a);`,
        `if(_nitroHandler.trace)_wsWrapped.trace=(...a)=>_nitroHandler.trace(...a);`,
        `export{_wsWrapped as default};`,
      ].join("\n");

      const newCode = code.replace(
        fullMatch,
        `${wsImport}\n${namedImport}\n${wrapper}`,
      );

      return { code: newCode, map: null };
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [tailwindcss(), wasm(), topLevelAwait()],
  },

  server: {
    preset: "cloudflare_module",
    compatibilityDate: "2026-01-16",
    // Expose UserDO class as a named export for the DO binding
    rollupConfig: {
      plugins: [cloudflareDoExportsPlugin(), cloudflareWsBypassPlugin()],
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

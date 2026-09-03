import { defineConfig } from "vitest/config";
import { resolve } from "path";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "~": resolve(__dirname, "./src"),
      "@sendme/ui": resolve(__dirname, "../packages/ui/src/index.ts"),
      "@sendme/shared": resolve(__dirname, "../packages/shared/src/index.ts"),
    },
    conditions: ["development", "browser"],
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    server: {
      deps: {
        inline: ["solid-icons", "@sendme/shared", "@sendme/ui"],
      },
    },
  },
});

import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    css: false,

    exclude: ["node_modules", ".next", "e2e", "tests/e2e/**", "tests/integration/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",

      exclude: [
        "tests/**",
        "**/*.config.*",
        "**/.next/**",
        "app/**/layout.tsx",
        "components/atoms/icons.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

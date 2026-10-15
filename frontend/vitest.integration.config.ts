import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "l3",
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],

    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,

    env: {
      RESEND_API_KEY: "l3-placeholder-the-transport-is-mocked",
      EMAIL_RELAY_ADDRESS: "talent@hiring.example.com",
      COMPANY_NAME: "Acme Inc.",
      COMPANY_CAREERS_URL: "https://jobs.example.com/careers",
      RESEND_WEBHOOK_SECRET: "whsec_bDMtaW5ib3VuZC13ZWJob29rLXNlY3JldC1ub3QtYS1yZWFsLW9uZQ==",
      SUPABASE_SERVICE_ROLE_KEY: "l3-placeholder-the-service-client-is-mocked",
      AUTOMATION_WORKER_SECRET: "l3-placeholder-automation-worker-secret",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

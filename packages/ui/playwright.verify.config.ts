import { defineConfig } from "@playwright/test";

/**
 * Playwright config for post-deploy visual verification.
 *
 * Targets a running container at VERIFY_URL (default: http://localhost:3000).
 * Used exclusively by the `verify-docker` job in release.yml — no webServer
 * fixture because the container is already started by that job.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "verify-deploy.spec.ts",
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: "list",

  use: {
    baseURL: process.env.VERIFY_URL ?? "http://localhost:3000",
  },

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});

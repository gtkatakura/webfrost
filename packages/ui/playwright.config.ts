import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Isolated data directory for each E2E run so tests never share state.
const e2eDir = mkdtempSync(join(tmpdir(), "webfrost-smoke-"));

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: "list",

  webServer: [
    {
      // Start the @webfrost/server API on port 3000 with a throwaway data dir.
      // AUTH_DISABLED=true skips session-secret requirement in E2E/dev environments.
      command: `WEBFROST_DIR=${e2eDir} AUTH_DISABLED=true bun run start`,
      cwd: join(__dirname, "../server"),
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      // Build the SDK (needed by Vite's import export condition), then build
      // the UI and serve it via vite preview (proxy /api → :3000).
      command: `(cd ${join(__dirname, "../sdk")} && bun run build) && bun run build && bunx vite preview --port 4173`,
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],

  use: {
    baseURL: "http://localhost:4173",
  },

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});

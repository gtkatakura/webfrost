import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Isolated data directories for each E2E run so tests never share state.
// Two servers run side by side:
//   - :3000 has auth disabled and serves most of the suite (UI via vite preview on :4173).
//   - :3001 has auth enabled and a fresh data directory, so the first-run setup wizard is
//     reachable. It serves the built UI itself and backs the "setup" and "auth" projects.
const e2eDir = mkdtempSync(join(tmpdir(), "webfrost-smoke-"));
const authE2eDir = mkdtempSync(join(tmpdir(), "webfrost-auth-"));

// Playwright's own browser download can be unavailable; point at a system Chromium instead.
const executablePath = process.env.WEBFROST_CHROMIUM_PATH || undefined;

// Specs that need the auth-enabled server on :3001. They depend on the setup spec,
// which creates the admin user and saves its session.
const authSpecs = ["**/api-keys.spec.ts", "**/auth.spec.ts"];

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: "list",

  webServer: [
    {
      // @webfrost/server API on port 3000 with a throwaway data dir and auth disabled.
      // WEBFROST_ALLOW_PRIVATE_URLS lets the previews spec archive a page served from localhost.
      command: `WEBFROST_DIR=${e2eDir} AUTH_DISABLED=true WEBFROST_ALLOW_PRIVATE_URLS=true bun run start`,
      cwd: join(__dirname, "../server"),
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      // Build the SDK (needed by Vite's import export condition), then build
      // the UI and serve it via vite preview (proxy /api -> :3000).
      command: `(cd ${join(__dirname, "../sdk")} && bun run build) && bun run build && bunx vite preview --port 4173`,
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Auth-enabled server on port 3001 with an empty data dir (no admin user yet).
      // It serves the UI build from packages/ui/dist, so it is listed after the build above.
      // `env -u` so an AUTH_DISABLED in the outer environment (CI sets one) cannot leak in.
      command: `env -u AUTH_DISABLED PORT=3001 WEBFROST_DIR=${authE2eDir} SESSION_SECRET=e2e-secret-for-testing-only-0123456789 bun run start`,
      cwd: join(__dirname, "../server"),
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],

  use: {
    baseURL: "http://localhost:4173",
    launchOptions: { executablePath },
  },

  projects: [
    {
      name: "chromium",
      testIgnore: ["**/setup.spec.ts", ...authSpecs],
      use: { browserName: "chromium" },
    },
    {
      // Runs the first-run wizard on the empty :3001 server and saves the admin session.
      name: "setup",
      testMatch: "**/setup.spec.ts",
      use: { browserName: "chromium", baseURL: "http://localhost:3001" },
    },
    {
      name: "auth",
      testMatch: authSpecs,
      dependencies: ["setup"],
      use: { browserName: "chromium", baseURL: "http://localhost:3001" },
    },
  ],
});

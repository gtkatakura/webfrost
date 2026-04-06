import { expect, test } from "@playwright/test";

/**
 * Post-deploy visual verification — run against a live Docker container.
 *
 * Checks:
 *   1. Page loads (not blank, HTTP 2xx)
 *   2. Visible structural content (heading or nav)
 *   3. No JS console errors
 *   4. Captures a screenshot as evidence
 *
 * Invoked by the `verify-docker` job in release.yml after the image is pushed.
 * Set VERIFY_URL to the running container base URL (e.g. http://localhost:3000).
 *
 * These tests are skipped in the regular E2E suite (when VERIFY_URL is not set)
 * because they are designed to run against a fully deployed Docker container
 * where both the UI and API are served from the same origin. In regular E2E the
 * UI (port 4173) and API (port 3000) are separate, so /health is not reachable
 * via the Vite proxy and the page is served by a different server.
 */

const VERIFY_URL = process.env.VERIFY_URL;

test.describe("post-deploy", () => {
  // Override baseURL to point at the live container instead of the Vite dev server.
  test.use({ baseURL: VERIFY_URL ?? "http://localhost:3000" });

  test("page loads with visible content", async ({ page }) => {
    test.skip(!VERIFY_URL, "Set VERIFY_URL=http://<host>:<port> to run post-deploy verification");

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");

    // Wait for the React app to hydrate and render content (the initial HTML is an empty SPA shell)
    await page.waitForLoadState("networkidle");

    // Page must not be blank
    const bodyText = (await page.locator("body").innerText()).trim();
    expect(bodyText.length, "Page body appears blank").toBeGreaterThan(20);

    // At least one structural element must be visible
    await expect(
      page.locator("h1, h2, nav, [role='navigation'], [role='main']").first(),
      "No headings or navigation found — page may be broken",
    ).toBeVisible({ timeout: 10_000 });

    // Screenshot evidence
    await page.screenshot({
      path: "test-results/deploy-screenshot.png",
      fullPage: true,
    });

    // No JS console errors
    expect(consoleErrors, `JS console errors detected:\n${consoleErrors.join("\n")}`).toHaveLength(
      0,
    );
  });

  test("/health returns ok", async ({ request }) => {
    test.skip(!VERIFY_URL, "Set VERIFY_URL=http://<host>:<port> to run post-deploy verification");

    const resp = await request.get("/health");
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe("ok");
  });
});

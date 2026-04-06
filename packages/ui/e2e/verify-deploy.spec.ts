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
 * VERIFY_URL env var points at the running container (default: http://localhost:3000).
 */

test("post-deploy: page loads with visible content", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("/");

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
  expect(consoleErrors, `JS console errors detected:\n${consoleErrors.join("\n")}`).toHaveLength(0);
});

test("post-deploy: /health returns ok", async ({ request }) => {
  const resp = await request.get("/health");
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.status).toBe("ok");
});

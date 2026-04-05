import { expect, test } from "@playwright/test";

/**
 * P3 E2E smoke test — @smoke
 *
 * Validates the full vertical slice:
 *   @webfrost/server → REST API → @webfrost/sdk → React render
 *
 * Requires: server running on :3000, UI served on :4173 (vite preview).
 * Both are started automatically by playwright.config.ts webServer fixtures.
 */

test("@smoke: dashboard loads and snapshot appears after POST", async ({ page, request }) => {
  // Navigate to the UI root.
  await page.goto("/");

  // Assert the Dashboard heading is visible.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // POST a snapshot via the API directly to avoid waiting for the pipeline.
  const resp = await request.post("http://localhost:3000/api/snapshots", {
    data: { url: "https://example.com" },
  });
  expect(resp.status()).toBe(202);

  // Navigate to the snapshots list page.
  await page.goto("/#/snapshots");

  // Wait for real snapshot rows to load (li > a structure).
  await expect(page.locator("li a").first()).toBeVisible({ timeout: 10_000 });

  // The snapshot row must be visible on the first page (most recent items first).
  await expect(page.getByText("https://example.com").first()).toBeVisible({ timeout: 5_000 });
});

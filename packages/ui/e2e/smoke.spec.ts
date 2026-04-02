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

  // Assert the WebFrost heading is visible.
  await expect(page.getByRole("heading", { name: "WebFrost" })).toBeVisible();

  // Assert the snapshot list container is rendered (even when empty).
  // The filter-by-URL input is always visible on the list page.
  await expect(page.getByPlaceholder("Filter by URL\u2026")).toBeVisible();

  // POST a snapshot via the API directly to avoid waiting for the pipeline.
  const resp = await request.post("http://localhost:3000/api/snapshots", {
    data: { url: "https://example.com" },
  });
  expect(resp.status()).toBe(202);

  // Reload the page so the React app refetches the snapshot list.
  await page.reload();

  // Wait for the snapshot row to appear in the list.
  await expect(page.getByText("https://example.com")).toBeVisible({ timeout: 10_000 });
});

import { expect, test } from "@playwright/test";

/** Import page: plain text URLs and switching between import types. */

test("import: plain text URLs shows queued count", async ({ page }) => {
  await page.goto("/#/import");

  // Verify page heading is present.
  await expect(page.getByRole("heading", { name: "Import URLs" })).toBeVisible();

  // Select "Plain Text URLs" tab.
  await page.getByRole("button", { name: "Plain Text URLs", exact: true }).click();

  // Fill in two URLs.
  const textarea = page.getByRole("textbox");
  await textarea.fill("https://import-e2e-1.example.com\nhttps://import-e2e-2.example.com");

  // Submit.
  await page.getByRole("button", { name: "Import", exact: true }).click();

  // Wait for result banner.
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 15_000 });

  // Verify the queued count is shown (2 fresh URLs -> "2 URLs queued for archiving.").
  await expect(page.getByText(/2 URLs queued/)).toBeVisible();
});

test("import: switching import type updates the form fields", async ({ page }) => {
  await page.goto("/#/import");

  // Default is RSS Feed URL: shows a URL input.
  await expect(page.getByPlaceholder("https://example.com/feed.xml")).toBeVisible();

  // Switch to Plain Text: shows a textarea.
  await page.getByRole("button", { name: "Plain Text URLs", exact: true }).click();
  await expect(page.getByRole("textbox")).toBeVisible();

  // Switch to OPML File: shows a file input.
  await page.getByRole("button", { name: "OPML File", exact: true }).click();
  await expect(page.locator('input[type="file"]')).toBeVisible();

  // Switch to Bookmarks HTML: shows a file input.
  await page.getByRole("button", { name: "Bookmarks HTML", exact: true }).click();
  await expect(page.locator('input[type="file"]')).toBeVisible();
});

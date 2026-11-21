import { expect, test } from "@playwright/test";

/** Settings page. */

test("settings: page renders with expected sections", async ({ page }) => {
  await page.goto("/#/settings");
  // Auth resolves asynchronously (setup status, then session), so use a generous
  // assertion timeout to let the protected route render.
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change Password" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Server Info" })).toBeVisible();
});

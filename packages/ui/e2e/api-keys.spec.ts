import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./support/admin";

/**
 * API key management (Settings > API Keys). Runs against the auth-enabled server on
 * :3001 with the admin session saved by setup.spec.ts.
 */

test.use({ storageState: ADMIN_STORAGE_STATE });

test("api keys: settings page links to the API key page", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.getByRole("link", { name: /Manage API Keys/ }).click();

  await expect(page).toHaveURL(/#\/settings\/api-keys/);
  await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
});

test("api keys: a created key is shown once and then listed by name", async ({ page }) => {
  const name = `e2e-create-${Date.now()}`;
  await page.goto("/#/settings/api-keys");

  await page.getByPlaceholder("Key name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // The raw key appears in a one-time banner.
  await expect(page.getByText(/It will not be shown again/)).toBeVisible();
  await expect(page.locator("input[readonly]")).not.toHaveValue("");

  // The key is listed by name.
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();

  // Dismissing the banner hides the raw key for good.
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText(/It will not be shown again/)).toBeHidden();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
});

test("api keys: revoking a key removes it from the list", async ({ page }) => {
  const name = `e2e-revoke-${Date.now()}`;
  await page.goto("/#/settings/api-keys");

  await page.getByPlaceholder("Key name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();

  // Revoking asks for confirmation through a browser dialog.
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Revoke" }).click();

  await expect(page.getByText("API key revoked")).toBeVisible();
  await expect(page.getByRole("cell", { name, exact: true })).toHaveCount(0);
});

test("api keys: cancelling the confirmation keeps the key", async ({ page }) => {
  const name = `e2e-keep-${Date.now()}`;
  await page.goto("/#/settings/api-keys");

  await page.getByPlaceholder("Key name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await row.getByRole("button", { name: "Revoke" }).click();

  await expect(row).toBeVisible();
});

import { expect, test } from "@playwright/test";

/** Schedules page: create, list and delete a recurring archive schedule. */

test("schedules: create, list, and delete a schedule", async ({ page }) => {
  // The list shows the URL without its scheme, so rows are matched by host.
  const host = `schedules-e2e-${Date.now()}.example.com`;
  const url = `https://${host}/`;
  await page.goto("/#/schedules");
  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible();

  // Create a schedule from a preset.
  await page.getByPlaceholder("https://example.com", { exact: true }).fill(url);
  await page.getByLabel("Preset").selectOption({ label: "Hourly" });
  await expect(page.getByLabel("Cron expression")).toHaveValue("0 * * * *");
  await page.getByRole("button", { name: "Add schedule" }).click();

  // It shows up in the list.
  await expect(page.getByText("Schedule created")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: host });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Hourly");

  // Delete asks for an inline confirmation.
  await row.getByRole("button", { name: "Delete schedule" }).click();
  await row.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByText("Schedule deleted")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: host })).toHaveCount(0);
});

test("schedules: cancelling the delete confirmation keeps the schedule", async ({ page }) => {
  const host = `schedules-keep-${Date.now()}.example.com`;
  const url = `https://${host}/`;
  await page.goto("/#/schedules");

  await page.getByPlaceholder("https://example.com", { exact: true }).fill(url);
  await page.getByLabel("Cron expression").fill("0 0 * * *");
  await page.getByRole("button", { name: "Add schedule" }).click();

  const row = page.getByRole("row").filter({ hasText: host });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Delete schedule" }).click();
  await row.getByRole("button", { name: "Cancel" }).click();

  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Delete schedule" })).toBeVisible();
});

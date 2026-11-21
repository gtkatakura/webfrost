import { expect, test } from "@playwright/test";

/**
 * Sidebar navigation.
 *
 * Note: the app uses HashRouter, so all navigation uses /#/path URLs.
 */

test("nav: sidebar renders all items and each navigates to its page", async ({ page }) => {
  await page.goto("/#/");

  const navItems = [
    { label: "Dashboard", hashPath: "#/" },
    { label: "Snapshots", hashPath: "#/snapshots" },
    { label: "Tags", hashPath: "#/tags" },
    { label: "Schedules", hashPath: "#/schedules" },
    { label: "Import", hashPath: "#/import" },
    { label: "Settings", hashPath: "#/settings" },
  ];

  for (const { label, hashPath } of navItems) {
    await page.getByRole("link", { name: label, exact: true }).click();
    // Wait for navigation with hash-based routing.
    await expect(page).toHaveURL(new RegExp(hashPath.replace("/", "\\/")));
    // The nav landmark proves Layout mounted correctly on each route.
    await expect(page.getByRole("navigation")).toBeVisible();
  }
});

test("nav: active link is highlighted when on its page", async ({ page }) => {
  await page.goto("/#/import");

  const importLink = page.getByRole("link", { name: "Import", exact: true });
  const tagsLink = page.getByRole("link", { name: "Tags", exact: true });

  // The active item is styled differently from inactive ones, so the classes must differ.
  const importClass = await importLink.getAttribute("class");
  const tagsClass = await tagsLink.getAttribute("class");
  expect(importClass).not.toEqual(tagsClass);
});

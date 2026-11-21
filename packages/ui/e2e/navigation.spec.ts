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

test.describe("phone layout", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("nav: the menu is one drawer, inert while closed, closed with Escape", async ({ page }) => {
    await page.goto("/#/");

    // Rendered once, and out of the accessibility tree while closed.
    await expect(page.locator("aside#app-sidebar")).toHaveCount(1);
    await expect(page.locator("aside#app-sidebar")).toHaveAttribute("inert", "");
    // Inert content cannot take focus, so keyboard users never land on an off-screen link.
    const focusable = await page.evaluate(() => {
      document.querySelector<HTMLElement>("#app-sidebar a")?.focus();
      return Boolean(document.activeElement?.closest("#app-sidebar"));
    });
    expect(focusable).toBe(false);

    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("aside#app-sidebar")).not.toHaveAttribute("inert", "");
    await expect(page.getByRole("link", { name: "Snapshots", exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
  });

  test("nav: a page does not scroll sideways at 375px", async ({ page }) => {
    for (const hash of ["/", "/snapshots", "/search?q=x", "/schedules", "/tags"]) {
      await page.goto(`/#${hash}`);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${hash}`).toBeLessThanOrEqual(0);
    }
  });
});

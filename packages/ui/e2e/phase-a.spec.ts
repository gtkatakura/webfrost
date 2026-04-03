import { expect, test } from "@playwright/test";

/**
 * Phase A E2E tests — @phase-a
 *
 * Covers the 7 test scenarios defined in WEB-85:
 *   1. Sidebar navigation          — WEB-84 (done)
 *   2. Extractor previews          — WEB-88 (todo)  ← skipped
 *   3. Tag assignment              — WEB-87 (in_progress) ← skipped
 *   4. Schedule management         — WEB-90 (todo)  ← skipped
 *   5. Import (plain text URLs)    — WEB-86 (done)
 *   6. Bulk operations             — WEB-89 (todo)  ← skipped
 *   7. Pagination                  — WEB-91 (done)
 *
 * Note: The app uses HashRouter, so all navigation uses /#/path URLs.
 */

// ---------------------------------------------------------------------------
// 1. Sidebar navigation
// ---------------------------------------------------------------------------

test("@phase-a nav: sidebar renders all items and each navigates to its page", async ({ page }) => {
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

test("@phase-a nav: active link is highlighted when on its page", async ({ page }) => {
  await page.goto("/#/import");

  const importLink = page.getByRole("link", { name: "Import", exact: true });
  const tagsLink = page.getByRole("link", { name: "Tags", exact: true });

  // Layout.tsx applies bg-gray-700 text-white font-semibold to the active item
  // and text-gray-300 hover:... to inactive items — classes must differ.
  const importClass = await importLink.getAttribute("class");
  const tagsClass = await tagsLink.getAttribute("class");
  expect(importClass).not.toEqual(tagsClass);
});

// ---------------------------------------------------------------------------
// 2. Extractor previews — skipped until WEB-88 is done
// ---------------------------------------------------------------------------

test.skip("@phase-a extractor-previews: screenshot, DOM snapshot, SingleFile previews load", async () => {
  // TODO: implement when WEB-88 (extractor preview UI) is done.
});

// ---------------------------------------------------------------------------
// 3. Tag assignment — skipped until WEB-87 is done
// ---------------------------------------------------------------------------

test.skip("@phase-a tags: add and remove tag on snapshot detail page", async () => {
  // TODO: implement when WEB-87 (tag assignment on detail page) is done.
});

// ---------------------------------------------------------------------------
// 4. Schedule management — skipped until WEB-90 is done
// ---------------------------------------------------------------------------

test.skip("@phase-a schedules: create, list, and delete a schedule", async () => {
  // TODO: implement when WEB-90 (schedule management page) is done.
});

// ---------------------------------------------------------------------------
// 5. Import — plain text URLs
// ---------------------------------------------------------------------------

test("@phase-a import: plain text URLs shows queued count", async ({ page, request }) => {
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

  // Verify the queued count is shown (2 fresh URLs → queued: 2).
  await expect(page.getByText(/Queued:\s*2/)).toBeVisible();
});

test("@phase-a import: switching import type updates the form fields", async ({ page }) => {
  await page.goto("/#/import");

  // Default is RSS Feed URL — should show a URL input.
  await expect(page.getByPlaceholder("https://example.com/feed.xml")).toBeVisible();

  // Switch to Plain Text — should show a textarea.
  await page.getByRole("button", { name: "Plain Text URLs", exact: true }).click();
  await expect(page.getByRole("textbox")).toBeVisible();

  // Switch to OPML File — should show a file input.
  await page.getByRole("button", { name: "OPML File", exact: true }).click();
  await expect(page.locator('input[type="file"]')).toBeVisible();

  // Switch to Bookmarks HTML — should show a file input.
  await page.getByRole("button", { name: "Bookmarks HTML", exact: true }).click();
  await expect(page.locator('input[type="file"]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 6. Bulk operations — skipped until WEB-89 is done
// ---------------------------------------------------------------------------

test.skip("@phase-a bulk: select multiple snapshots and bulk delete", async () => {
  // TODO: implement when WEB-89 (bulk operations on snapshot list) is done.
});

// ---------------------------------------------------------------------------
// 7. Pagination — server-side API (WEB-91)
//
// NOTE: The UI pagination is currently broken because useSnapshots() always
// calls listSnapshots() with no page/limit options, so the server returns at
// most 20 items (default limit) and the client-side totalPages stays at 1.
// See the bug filed against the Engineer for the fix.
// This test validates the server-side pagination API directly.
// ---------------------------------------------------------------------------

test("@phase-a pagination: server API returns correct pages", async ({ request }) => {
  // Seed 25 unique snapshots so we can verify multi-page behaviour.
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      request.post("http://localhost:3000/api/snapshots", {
        data: { url: `https://pagination-api-${i}.example.com` },
      }),
    ),
  );

  // Page 1 with limit 20 should return 20 items.
  const r1 = await request.get("http://localhost:3000/api/snapshots?page=1&limit=20");
  expect(r1.status()).toBe(200);
  const body1 = await r1.json();
  expect(body1.items).toHaveLength(20);
  expect(body1.total).toBeGreaterThanOrEqual(25);
  expect(body1.page).toBe(1);
  expect(body1.limit).toBe(20);

  // Page 2 should return the remaining items (≥5).
  const r2 = await request.get("http://localhost:3000/api/snapshots?page=2&limit=20");
  expect(r2.status()).toBe(200);
  const body2 = await r2.json();
  expect(body2.items.length).toBeGreaterThanOrEqual(5);
  expect(body2.page).toBe(2);
  expect(body2.total).toBe(body1.total); // total count is consistent across pages

  // Pages 1 and 2 must not overlap.
  const ids1 = new Set(body1.items.map((s: { id: number }) => s.id));
  for (const item of body2.items) {
    expect(ids1.has(item.id)).toBe(false);
  }
});

test("@phase-a pagination: UI controls appear and navigate between pages", async ({
  page,
  request,
}) => {
  // Fetch the current snapshot count before seeding so we can compute the
  // expected total pages even when prior tests left rows in the shared DB.
  const beforeResp = await request.get("http://localhost:3000/api/snapshots?page=1&limit=1");
  const beforeBody = await beforeResp.json();
  const existingCount: number = beforeBody.total ?? 0;

  // Seed enough snapshots to guarantee at least 2 pages of 20.
  // We need (existingCount + seeded) > 20, so we add 21 to be safe.
  const SEED = 21;
  const PAGE_SIZE = 20;
  await Promise.all(
    Array.from({ length: SEED }, (_, i) =>
      request.post("http://localhost:3000/api/snapshots", {
        data: { url: `https://pagination-ui-${Date.now()}-${i}.example.com` },
      }),
    ),
  );

  const totalCount = existingCount + SEED;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  await page.goto("/#/snapshots");

  // Wait until the list renders (skeleton gone, at least one row visible).
  await expect(page.locator("li").first()).toBeVisible({ timeout: 10000 });

  // Pagination controls must appear since totalPages > 1.
  const nextBtn = page.getByRole("button", { name: /Next/i });
  const prevBtn = page.getByRole("button", { name: /Prev/i });
  await expect(nextBtn).toBeVisible();
  await expect(prevBtn).toBeVisible();

  // Page indicator shows "1 / <totalPages>".
  await expect(page.getByText(`1 / ${totalPages}`)).toBeVisible();

  // Record the first item on page 1 so we can verify page 2 is different.
  const firstItemPage1 = await page.locator("li").first().textContent();

  // Navigate to page 2.
  await nextBtn.click();
  await expect(page.getByText(`2 / ${totalPages}`)).toBeVisible();

  // At least one item is visible on page 2.
  await expect(page.locator("li").first()).toBeVisible();
  const firstItemPage2 = await page.locator("li").first().textContent();
  expect(firstItemPage2).not.toBe(firstItemPage1);

  // Navigate back to page 1.
  await prevBtn.click();
  await expect(page.getByText(`1 / ${totalPages}`)).toBeVisible();
  await expect(page.locator("li").first()).toBeVisible();
});

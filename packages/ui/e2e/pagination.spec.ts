import { expect, test } from "@playwright/test";

/** Snapshot list pagination: the server API and the UI controls. */

test("pagination: server API returns correct pages", async ({ request }) => {
  // Seed 25 unique snapshots so we can verify multi-page behaviour.
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      request.post("http://localhost:3000/api/v1/snapshots", {
        data: { url: `https://pagination-api-${i}.example.com` },
      }),
    ),
  );

  // Page 1 with limit 20 should return 20 items.
  const r1 = await request.get("http://localhost:3000/api/v1/snapshots?page=1&limit=20");
  expect(r1.status()).toBe(200);
  const body1 = await r1.json();
  expect(body1.items).toHaveLength(20);
  expect(body1.total).toBeGreaterThanOrEqual(25);
  expect(body1.page).toBe(1);
  expect(body1.limit).toBe(20);

  // Page 2 should return the remaining items (>= 5).
  const r2 = await request.get("http://localhost:3000/api/v1/snapshots?page=2&limit=20");
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

test("pagination: UI controls appear and navigate between pages", async ({ page, request }) => {
  // Seed 21 snapshots: enough to guarantee at least 2 pages of 20 regardless
  // of how many items other tests left in the shared DB.
  await Promise.all(
    Array.from({ length: 21 }, (_, i) =>
      request.post("http://localhost:3000/api/v1/snapshots", {
        data: { url: `https://pagination-ui-${Date.now()}-${i}.example.com` },
      }),
    ),
  );

  await page.goto("/#/snapshots");

  // Wait until real snapshot rows load. Skeleton rows render as <li> without
  // a child <a>, so "li a" only matches once actual data is in the DOM.
  await expect(page.locator("li a").first()).toBeVisible({ timeout: 10000 });

  // Pagination controls must appear since totalPages > 1.
  const nextBtn = page.getByRole("button", { name: /Next/i });
  const prevBtn = page.getByRole("button", { name: /Prev/i });
  await expect(nextBtn).toBeVisible();
  await expect(prevBtn).toBeVisible();

  // The Pagination component renders numbered buttons with aria-current="page"
  // on the active page. Verify page 1 is active and that there are several pages.
  await expect(page.locator('[aria-label="Page 1"][aria-current="page"]')).toBeVisible();
  const totalPages = await page.locator('button[aria-label^="Page "]').count();
  expect(totalPages).toBeGreaterThan(1);

  // Record the first item on page 1 so we can verify page 2 is different.
  const firstItemPage1 = await page.locator("li a").first().textContent();

  // Navigate to page 2.
  await nextBtn.click();
  await expect(page.locator('[aria-label="Page 2"][aria-current="page"]')).toBeVisible();

  // At least one item is visible on page 2.
  await expect(page.locator("li a").first()).toBeVisible();
  const firstItemPage2 = await page.locator("li a").first().textContent();
  expect(firstItemPage2).not.toBe(firstItemPage1);

  // Navigate back to page 1.
  await prevBtn.click();
  await expect(page.locator('[aria-label="Page 1"][aria-current="page"]')).toBeVisible();
  await expect(page.locator("li a").first()).toBeVisible();
});

import { type Page, expect, test } from "@playwright/test";

/**
 * Failure states, URL input forgiveness and the scope of selections on the snapshot list.
 * The server rate-limits snapshot creation (60/min) and the rest of the suite is close to that
 * budget, so these tests mock the API instead of seeding real snapshots.
 */

function fakeItem(id: number) {
  return {
    id,
    url: `https://fake-${id}.example.com/`,
    status: "done",
    createdAt: "2026-01-01T10:00:00.000Z",
    extractors: [],
    tags: [],
    title: null,
    excerpt: null,
    screenshotUrl: null,
  };
}

/** A list of 21 snapshots: 20 on page 1, one on page 2. */
async function mockTwoPages(page: Page) {
  await page.route("**/api/v1/snapshots?**", (route) => {
    const url = new URL(route.request().url());
    const p = Number(url.searchParams.get("page") ?? "1");
    const items = p === 1 ? Array.from({ length: 20 }, (_, i) => fakeItem(i + 1)) : [fakeItem(21)];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items, total: 21, page: p, limit: 20 }),
    });
  });
}

test("states: a failing snapshot list shows an error with Retry, not 'No snapshots yet'", async ({
  page,
}) => {
  let failing = true;
  await page.route("**/api/v1/snapshots?**", (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' })
      : route.continue(),
  );
  await page.goto("/#/snapshots");

  await expect(page.getByRole("alert").getByText("Could not load snapshots")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("No snapshots yet")).toHaveCount(0);

  failing = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("alert").getByText("Could not load snapshots")).toBeHidden();
});

test("states: when the server cannot be reached the app says so instead of showing a login form", async ({
  page,
}) => {
  await page.route("**/api/v1/setup/status", (route) => route.abort());
  await page.goto("/#/");
  await expect(page.getByText("Can't reach the WebFrost server")).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveCount(0);

  await page.unroute("**/api/v1/setup/status");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("url input: a bare domain is accepted and sent with https:// prepended", async ({ page }) => {
  let sent: { url?: string } = {};
  await page.route("**/api/v1/snapshots", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent = route.request().postDataJSON();
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ id: 1, url: sent.url, status: "pending" }),
    });
  });
  await page.goto("/#/");

  await page.getByPlaceholder(/archive a URL/).fill("bare-domain.example.com");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Snapshot queued")).toBeVisible();
  expect(sent.url).toBe("https://bare-domain.example.com/");
});

test("url input: an invalid address is explained inline", async ({ page }) => {
  await page.goto("/#/");
  await page.getByPlaceholder(/archive a URL/).fill("not a url");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("alert").getByText(/valid web address/)).toBeVisible();
});

test("selection: changing page drops the selection so bulk actions never reach hidden rows", async ({
  page,
}) => {
  await mockTwoPages(page);
  await page.goto("/#/snapshots");
  await expect(page.locator("li a").first()).toBeVisible({ timeout: 10_000 });

  await page.getByLabel("Select all").check();
  await expect(page.getByText("20 selected")).toBeVisible();

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('[aria-label="Page 2"][aria-current="page"]')).toBeVisible();
  await expect(page.getByText(/\d+ selected/)).toBeHidden();
});

test("selection: the confirmation names exactly how many snapshots will be deleted", async ({
  page,
}) => {
  await mockTwoPages(page);
  await page.goto("/#/snapshots");
  await page.getByLabel("Select https://fake-1.example.com/").check();
  await page.getByLabel("Select https://fake-2.example.com/").check();

  let message = "";
  page.once("dialog", (dialog) => {
    message = dialog.message();
    dialog.dismiss();
  });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  expect(message).toContain("Delete 2 selected snapshots");
});

test("list: the page number lives in the URL and a page past the end steps back", async ({
  page,
}) => {
  await page.route("**/api/v1/snapshots?**", (route) => {
    const url = new URL(route.request().url());
    const p = Number(url.searchParams.get("page") ?? "1");
    const items = p === 1 ? [fakeItem(1), fakeItem(2)] : [];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items, total: 2, page: p, limit: 20 }),
    });
  });
  await page.goto("/#/snapshots?page=9999");
  await expect(page.locator("li a").first()).toBeVisible({ timeout: 10_000 });
  await expect(page).not.toHaveURL(/page=9999/);
});

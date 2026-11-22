import { expect, test } from "@playwright/test";

/** The snapshot viewer: one snapshot on the whole window, at /snapshots/:id. */

const API = "http://localhost:3000";

// Reuse a snapshot that already exists: the server rate-limits snapshot creation (60/min) and
// the rest of the suite is close to that budget. Only a fresh database needs one created.
let seeded: { id: number; url: string };

test.beforeAll(async ({ request }) => {
  const list = await (await request.get(`${API}/api/v1/snapshots?page=1&limit=1`)).json();
  if (list.items[0]) {
    seeded = { id: list.items[0].id, url: list.items[0].url };
    return;
  }
  const url = `https://panel-${Date.now()}.example.com/`;
  const resp = await request.post(`${API}/api/v1/snapshots`, { data: { url } });
  expect(resp.status()).toBe(202);
  seeded = { id: (await resp.json()).id as number, url };
});

const seed = async (_request?: unknown) => seeded;

test("viewer: /snapshots/:id fills the window and Escape goes back to the list", async ({
  page,
  request,
}) => {
  const { id, url } = await seed(request);
  await page.goto(`/#/snapshots/${id}`);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: url })).toBeVisible();
  // No app sidebar: the snapshot has the window.
  await expect(page.getByRole("navigation")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/snapshots$/);
  await expect(page.getByRole("heading", { name: "Snapshots", exact: true })).toBeVisible();
});

test("viewer: opened from a list page, Back returns to that page", async ({ page, request }) => {
  const { url } = await seed(request);
  await page.goto("/#/snapshots");
  await page.getByRole("link", { name: url }).first().click();
  await expect(page.getByRole("button", { name: "Back to snapshots" })).toBeVisible();
  await page.getByRole("button", { name: "Back to snapshots" }).click();
  await expect(page.getByRole("heading", { name: "Snapshots", exact: true })).toBeVisible();
});

test("viewer: the views follow the WAI-ARIA tabs pattern with arrow-key navigation", async ({
  page,
  request,
}) => {
  const { id } = await seed(request);
  await page.goto(`/#/snapshots/${id}`);

  const tablist = page.getByRole("tablist");
  await expect(tablist).toBeVisible();
  const selected = tablist.getByRole("tab", { selected: true });
  await expect(selected).toHaveCount(1);
  await selected.focus();

  const before = await selected.innerText();
  await page.keyboard.press("ArrowRight");
  const next = tablist.getByRole("tab", { selected: true });
  await expect(next).toBeFocused();
  await expect(next).not.toHaveText(before);
  await expect(page.getByRole("tabpanel")).toBeVisible();

  await page.keyboard.press("End");
  await expect(tablist.getByRole("tab", { name: "Details" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("viewer: I switches to the Details view", async ({ page, request }) => {
  const { id } = await seed(request);
  await page.goto(`/#/snapshots/${id}`);
  await page.getByRole("button", { name: "Back to snapshots" }).focus();
  await page.keyboard.press("i");
  await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Extractors")).toBeVisible();
});

test("viewer: a malformed ?detail= opens nothing", async ({ page }) => {
  await page.goto("/#/snapshots?detail=abc");
  await expect(page.getByRole("heading", { name: "Snapshots", exact: true })).toBeVisible();
});

test("viewer: the legacy ?detail= link opens the viewer", async ({ page, request }) => {
  const { id } = await seed(request);
  await page.goto(`/#/snapshots?detail=${id}`);
  await expect(page).toHaveURL(new RegExp(`#/snapshots/${id}$`));
  await expect(page.getByRole("button", { name: "Back to snapshots" })).toBeVisible();
});

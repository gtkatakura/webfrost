import { expect, test } from "@playwright/test";

/** The detail panel is the one detail UI: a dialog over the list, reachable at /snapshots/:id. */

const API = "http://localhost:3000";

// Reuse a snapshot that already exists: the server rate-limits snapshot creation (60/min) and
// the rest of the suite is close to that budget. Only a fresh database needs one created.
let seeded: { id: number; url: string };

test.beforeAll(async ({ request }) => {
  const list = await (await request.get(`${API}/api/snapshots?page=1&limit=1`)).json();
  if (list.items[0]) {
    seeded = { id: list.items[0].id, url: list.items[0].url };
    return;
  }
  const url = `https://panel-${Date.now()}.example.com/`;
  const resp = await request.post(`${API}/api/snapshots`, { data: { url } });
  expect(resp.status()).toBe(202);
  seeded = { id: (await resp.json()).id as number, url };
});

const seed = async (_request?: unknown) => seeded;

test("detail panel: /snapshots/:id opens a labelled dialog over the list and Escape closes it", async ({
  page,
  request,
}) => {
  const { id, url } = await seed(request);
  await page.goto(`/#/snapshots/${id}`);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  // The dialog is named by its heading.
  await expect(dialog.getByRole("heading").first()).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/.+/);
  await expect(dialog.getByRole("link", { name: url })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/snapshots$/);
  // The list is still there behind it.
  await expect(page.getByRole("heading", { name: "Snapshots", exact: true })).toBeVisible();
});

test("detail panel: opening a row keeps focus manageable and restores it on close", async ({
  page,
  request,
}) => {
  const { url } = await seed(request);
  await page.goto("/#/snapshots");

  const rowLink = page.getByRole("link", { name: url });
  await rowLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(rowLink).toBeFocused();
});

test("detail panel: tabs follow the WAI-ARIA tabs pattern with arrow-key navigation", async ({
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
  await expect(tablist.getByRole("tab", { name: "History" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("detail panel: a malformed ?detail= opens nothing instead of a broken panel", async ({
  page,
}) => {
  await page.goto("/#/snapshots?detail=abc");
  await expect(page.getByRole("heading", { name: "Snapshots", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("detail panel: the legacy ?detail= link still opens the panel", async ({ page, request }) => {
  const { id } = await seed(request);
  await page.goto(`/#/snapshots?detail=${id}`);
  await expect(page.getByRole("dialog")).toBeVisible();
});

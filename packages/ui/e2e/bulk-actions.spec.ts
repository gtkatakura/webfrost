import { expect, test } from "@playwright/test";

/** Snapshot list: selecting several snapshots and acting on them at once. */

const API = "http://localhost:3000";

async function seed(request: import("@playwright/test").APIRequestContext, prefix: string) {
  const stamp = Date.now();
  const urls = [1, 2].map((n) => `https://${prefix}-${stamp}-${n}.example.com/`);
  for (const url of urls) {
    const resp = await request.post(`${API}/api/v1/snapshots`, { data: { url } });
    expect(resp.status()).toBe(202);
  }
  return urls;
}

test("bulk actions: select multiple snapshots and delete them", async ({ page, request }) => {
  const [first, second] = await seed(request, "bulk-delete");
  await page.goto("/#/snapshots");

  const firstBox = page.getByLabel(`Select ${first}`);
  const secondBox = page.getByLabel(`Select ${second}`);
  await firstBox.check();
  await secondBox.check();

  await expect(page.getByText("2 selected")).toBeVisible();

  // Deleting asks for confirmation through a browser dialog.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(firstBox).toHaveCount(0);
  await expect(secondBox).toHaveCount(0);
  await expect(page.getByText("2 selected")).toBeHidden();
});

test("bulk actions: cancelling the confirmation keeps the snapshots", async ({ page, request }) => {
  const [first] = await seed(request, "bulk-keep");
  await page.goto("/#/snapshots");

  await page.getByLabel(`Select ${first}`).check();
  await expect(page.getByText("1 selected")).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByLabel(`Select ${first}`)).toBeVisible();

  // Clearing the selection hides the action bar.
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.getByText("1 selected")).toBeHidden();
});

test("bulk actions: tag several snapshots at once", async ({ page, request }) => {
  const tagName = `e2e-bulk-${Date.now()}`;
  const tag = await (await request.post(`${API}/api/v1/tags`, { data: { name: tagName } })).json();
  const urls = await seed(request, "bulk-tag");
  await page.goto("/#/snapshots");

  for (const url of urls) await page.getByLabel(`Select ${url}`).check();
  await page.getByRole("combobox").last().selectOption({ label: tagName });

  // Both snapshots carry the tag once the bulk action finishes.
  await expect
    .poll(async () => {
      const list = await (await request.get(`${API}/api/v1/snapshots?page=1&limit=100`)).json();
      return list.items.filter(
        (s: { url: string; tags: { id: number }[] }) =>
          urls.includes(s.url) && s.tags.some((t) => t.id === tag.id),
      ).length;
    })
    .toBe(2);
});

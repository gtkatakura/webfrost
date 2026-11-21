import { expect, test } from "@playwright/test";

/** Tags: managing tags on the Tags page and assigning them in the snapshot detail panel. */

const API = "http://localhost:3000";

test("tags: create and delete a tag on the tags page", async ({ page }) => {
  const name = `e2e-tag-${Date.now()}`;
  await page.goto("/#/tags");

  await page.getByPlaceholder("New tag name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  const row = page.locator("main li").filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("main li").filter({ hasText: name })).toHaveCount(0);
});

test("tags: add and remove a tag on the snapshot detail panel", async ({ page, request }) => {
  const tagName = `e2e-assign-${Date.now()}`;

  const tagResp = await request.post(`${API}/api/tags`, { data: { name: tagName } });
  expect(tagResp.ok()).toBe(true);
  const tag = await tagResp.json();

  const snapResp = await request.post(`${API}/api/snapshots`, {
    data: { url: `https://tags-e2e-${Date.now()}.example.com` },
  });
  expect(snapResp.status()).toBe(202);
  const { id } = await snapResp.json();

  // The list page opens the detail panel from the ?detail= query parameter.
  await page.goto(`/#/snapshots?detail=${id}`);
  await expect(page.getByText("No tags")).toBeVisible();

  // Add the tag through the picker.
  await page.getByRole("button", { name: "Add tag" }).click();
  await page.getByRole("combobox").selectOption({ label: tagName });
  await expect(page.getByRole("button", { name: `Remove tag ${tagName}` })).toBeVisible();

  // The assignment is persisted on the server.
  const assigned = await (await request.get(`${API}/api/snapshots/${id}/tags`)).json();
  expect(assigned.map((t: { id: number }) => t.id)).toContain(tag.id);

  // Remove it again.
  await page.getByRole("button", { name: `Remove tag ${tagName}` }).click();
  await expect(page.getByRole("button", { name: `Remove tag ${tagName}` })).toHaveCount(0);
  await expect(page.getByText("No tags")).toBeVisible();
});

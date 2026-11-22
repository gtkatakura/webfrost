import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

/**
 * Extractor previews in the snapshot detail panel: readable text, screenshot and the
 * sandboxed DOM / SingleFile page.
 *
 * The page being archived is served by the test itself, so the suite needs no internet
 * access. The :3000 server runs with WEBFROST_ALLOW_PRIVATE_URLS=true (see
 * playwright.config.ts) so that it may fetch it. Needs a Chromium for the extractors.
 */

const API = "http://localhost:3000";
const PAGE_TITLE = "WebFrost preview fixture";
const PAGE_TEXT = "Frozen pages stay readable long after the original disappears.";

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${PAGE_TITLE}</title></head>
  <body>
    <article>
      <h1>${PAGE_TITLE}</h1>
      <p>${PAGE_TEXT}</p>
      <p>${"The archive keeps a readable copy, a screenshot and a full DOM snapshot of this page. ".repeat(8)}</p>
      <p>${"Readability needs enough paragraphs of prose to treat this as an article. ".repeat(8)}</p>
    </article>
  </body>
</html>`;

let fixture: Server;
let fixtureUrl: string;
let snapshotId: number;

test.beforeAll(async ({ request }) => {
  fixture = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  fixtureUrl = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/`;

  const resp = await request.post(`${API}/api/v1/snapshots`, { data: { url: fixtureUrl } });
  expect(resp.status()).toBe(202);
  snapshotId = (await resp.json()).id;

  // Wait for the pipeline to finish so every extractor result is stored.
  await expect
    .poll(
      async () =>
        (await (await request.get(`${API}/api/v1/snapshots/${snapshotId}`)).json()).status,
      {
        timeout: 90_000,
        intervals: [1_000],
      },
    )
    .toMatch(/done|failed/);
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});

test("previews: archived page produces the extractor results", async ({ request }) => {
  const detail = await (await request.get(`${API}/api/v1/snapshots/${snapshotId}`)).json();
  expect(detail.status).toBe("done");
  const extractors = detail.archiveResults.map((r: { extractor: string }) => r.extractor);
  expect(extractors).toContain("readability");
  expect(extractors).toContain("screenshot");
  expect(extractors).toContain("dom-snapshot");
});

test("previews: reader tab shows the readable text", async ({ page }) => {
  await page.goto(`/#/snapshots/${snapshotId}`);

  await page.getByRole("tab", { name: "Reader", exact: true }).click();
  await expect(page.getByRole("tabpanel").getByRole("heading", { name: PAGE_TITLE })).toBeVisible();
  await expect(page.getByText(PAGE_TEXT)).toBeVisible();
});

test("previews: screenshot tab loads the image", async ({ page }) => {
  await page.goto(`/#/snapshots/${snapshotId}`);

  await page.getByRole("tab", { name: "Screenshot", exact: true }).click();
  const image = page.getByAltText("Page screenshot");
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
});

test("previews: DOM tab frames the archived page in a sandboxed iframe", async ({ page }) => {
  await page.goto(`/#/snapshots/${snapshotId}`);

  await page.getByRole("tab", { name: "DOM", exact: true }).click();
  const iframe = page.locator('iframe[title="Archived page preview"]');
  await expect(iframe).toBeVisible();
  // Untrusted HTML must be framed with every sandbox permission off.
  await expect(iframe).toHaveAttribute("sandbox", "");

  await expect(
    page.frameLocator('iframe[title="Archived page preview"]').getByText(PAGE_TEXT),
  ).toBeVisible();
});

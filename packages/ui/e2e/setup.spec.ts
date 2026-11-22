import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_STORAGE_STATE, ADMIN_USERNAME } from "./support/admin";

/**
 * First-run setup wizard. Runs against the auth-enabled server on :3001, which starts
 * with an empty data directory. The tests are order-dependent: the first one creates the
 * admin user, the rest see a completed setup. The wizard signs the new admin in, and that
 * session is saved for the specs of the "auth" project.
 *
 * The app uses HashRouter, so all navigation uses /#/path URLs.
 */

test.describe.configure({ mode: "serial" });

test("setup: every route redirects to the wizard until an admin exists", async ({ page }) => {
  for (const route of ["/#/", "/#/snapshots", "/#/login", "/#/settings"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/#\/setup/);
  }
  await expect(page.getByText("Set up your admin account")).toBeVisible();
});

test("setup: mismatched or short passwords are rejected", async ({ page }) => {
  await page.goto("/#/setup");

  await page.getByLabel("Username").fill(ADMIN_USERNAME);
  await page.getByLabel("Password", { exact: true }).fill("password-one");
  await page.getByLabel("Confirm password").fill("password-two");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();

  // The password fields carry minLength=8, so the browser itself blocks a short password.
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("short");
  const tooShort = await page
    .getByLabel("Password", { exact: true })
    .evaluate((el) => (el as HTMLInputElement).validity.tooShort);
  expect(tooShort).toBe(true);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/#\/setup/);
});

test("setup: wizard creates the admin, shows the API key once and signs in", async ({
  page,
  context,
}) => {
  await page.goto("/#/setup");

  await page.getByLabel("Username").fill(ADMIN_USERNAME);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel("Confirm password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // Second step: the one-time API key.
  await expect(page.getByText("This API key will not be shown again.")).toBeVisible();
  await expect(page.getByLabel("API key")).not.toHaveValue("");

  await page.getByRole("button", { name: "Go to dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();

  await context.storageState({ path: ADMIN_STORAGE_STATE });
});

test("setup: wizard is not reachable once an admin exists", async ({ page, request }) => {
  // The API refuses a second setup.
  const resp = await request.post("/api/v1/setup", {
    data: { username: "second-admin", password: "another-password" },
  });
  expect(resp.status()).toBe(409);

  // The UI no longer has a /setup route: a visitor without a session lands on login.
  await page.goto("/#/setup");
  await expect(page).toHaveURL(/#\/login/);
});

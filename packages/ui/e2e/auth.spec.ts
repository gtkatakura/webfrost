import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_STORAGE_STATE, ADMIN_USERNAME } from "./support/admin";

/**
 * Login, logout, session persistence and route protection. Runs against the
 * auth-enabled server on :3001 after setup.spec.ts has created the admin user.
 *
 * Password endpoints are rate limited (10 per minute), so only the tests about the
 * login form itself submit credentials; the others reuse the saved admin session.
 */

const PROTECTED_ROUTES = [
  "/#/",
  "/#/snapshots",
  "/#/tags",
  "/#/schedules",
  "/#/import",
  "/#/settings",
];

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/#/login");
  await page.getByLabel("Username").fill(ADMIN_USERNAME);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("signed out", () => {
  test("login: valid credentials open the dashboard", async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page).not.toHaveURL(/#\/login/);
  });

  test("login: invalid credentials show an error and stay on the login page", async ({ page }) => {
    await page.goto("/#/login");
    await page.getByLabel("Username").fill(ADMIN_USERNAME);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid username or password.")).toBeVisible();
    await expect(page).toHaveURL(/#\/login/);
  });

  test("login: empty fields are blocked by form validation", async ({ page }) => {
    await page.goto("/#/login");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/#\/login/);
    const usernameValid = await page
      .getByLabel("Username")
      .evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(usernameValid).toBe(false);
  });

  test("route guard: protected routes redirect to the login page", async ({ page }) => {
    for (const route of PROTECTED_ROUTES) {
      await page.goto(route);
      await expect(page).toHaveURL(/#\/login/);
    }
  });
});

test.describe("signed in", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("session: stays signed in across page reloads", async ({ page }) => {
    await page.goto("/#/snapshots");
    await expect(page.getByRole("navigation")).toBeVisible();

    await page.reload();

    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page).toHaveURL(/#\/snapshots/);
    await expect(page).not.toHaveURL(/#\/login/);
  });

  test("route guard: every route is reachable", async ({ page }) => {
    for (const route of PROTECTED_ROUTES) {
      await page.goto(route);
      await expect(page.getByRole("navigation")).toBeVisible();
      await expect(page).not.toHaveURL(/#\/login/);
    }
  });

  test("login page redirects away when already signed in", async ({ page }) => {
    await page.goto("/#/login");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page).not.toHaveURL(/#\/login/);
  });
});

test.describe("logout", () => {
  // Logging out revokes the session on the server, so this test signs in with its own
  // session instead of the shared one saved by the setup spec.
  test("sign out ends the session and protects the routes again", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("navigation")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/#\/login/);

    await page.goto("/#/snapshots");
    await expect(page).toHaveURL(/#\/login/);

    // The session is gone after a reload too, not just in memory.
    await page.reload();
    await expect(page).toHaveURL(/#\/login/);
  });
});

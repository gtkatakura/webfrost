import { expect, test } from "@playwright/test";

/**
 * Phase C E2E tests — @phase-c
 *
 * Covers the auth UI acceptance criteria from WEB-108:
 *   1. Login flow (success)              — WEB-104 (in_progress) ← skipped
 *   2. Login flow (failure)              — WEB-104 (in_progress) ← skipped
 *   3. Session persistence               — WEB-104 (in_progress) ← skipped
 *   4. Logout                            — WEB-104 (in_progress) ← skipped
 *   5. Auth-gated route protection       — WEB-104 (in_progress) ← skipped
 *   6. API key CRUD                      — WEB-105 (todo) ← skipped
 *   7. First-run setup wizard            — WEB-106 (todo) ← skipped
 *   8. Settings page                     — WEB-107 (todo) ← skipped
 *
 * All tests are skipped until the corresponding UI features land.
 * To activate auth E2E tests the server must start with SESSION_SECRET set
 * and without AUTH_DISABLED=true. See the comment in playwright.config.ts.
 *
 * Assumed credentials (seeded in global setup or beforeEach):
 *   username: "admin"
 *   password: "password123"
 */

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "password123";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Log in via the UI login form and wait for the dashboard to appear. */
async function loginViaUI(
  page: import("@playwright/test").Page,
  username = ADMIN_USERNAME,
  password = ADMIN_PASSWORD,
) {
  await page.goto("/#/login");

  // When AUTH_DISABLED is active the app treats the session as authenticated
  // and redirects away from /login before the form renders — nothing to fill.
  const usernameInput = page.getByLabel(/username/i);
  const formVisible = await usernameInput.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!formVisible) return;

  await usernameInput.fill(username);
  await page.getByLabel(/password/i, { exact: true }).fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/(#\/|#\/snapshots)/);
}

// ---------------------------------------------------------------------------
// 1. Login flow — success
// ---------------------------------------------------------------------------

test.skip("@phase-c login: valid credentials redirect to dashboard", async ({ page }) => {
  // TODO: activate when WEB-104 (login page + session flow) is done.
  await loginViaUI(page);

  // After successful login the main dashboard or snapshots list is visible.
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page).toHaveURL(/(#\/|#\/snapshots)/);
});

// ---------------------------------------------------------------------------
// 2. Login flow — failure
// ---------------------------------------------------------------------------

test.skip("@phase-c login: invalid credentials show error message", async ({ page }) => {
  // TODO: activate when WEB-104 (login page + session flow) is done.
  await page.goto("/#/login");
  await page.getByLabel(/username/i).fill(ADMIN_USERNAME);
  await page.getByLabel(/password/i).fill("wrong-password");
  await page.getByRole("button", { name: /log in/i }).click();

  // Should stay on the login page and show an error.
  await expect(page).toHaveURL(/#\/login/);
  await expect(
    page.getByText(/invalid credentials|incorrect password|unauthorized/i),
  ).toBeVisible();
});

test.skip("@phase-c login: empty fields show validation error", async ({ page }) => {
  // TODO: activate when WEB-104 (login page + session flow) is done.
  await page.goto("/#/login");
  await page.getByRole("button", { name: /log in/i }).click();

  // HTML5 required validation or custom error should prevent submission.
  // The page must remain at /#/login.
  await expect(page).toHaveURL(/#\/login/);
});

// ---------------------------------------------------------------------------
// 3. Session persistence
// ---------------------------------------------------------------------------

test.skip("@phase-c session: session cookie persists across page reloads", async ({ page }) => {
  // TODO: activate when WEB-104 (login page + session flow) is done.
  await loginViaUI(page);

  // Reload the page — cookie should keep the session alive.
  await page.reload();

  // Still logged in: navigation is visible and no redirect to /login.
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page).not.toHaveURL(/#\/login/);
});

// ---------------------------------------------------------------------------
// 4. Logout
// ---------------------------------------------------------------------------

test.skip("@phase-c logout: logout button clears session and redirects to login", async ({
  page,
}) => {
  // TODO: activate when WEB-104 (login page + session flow) is done.
  await loginViaUI(page);

  // Click the logout button (expected in sidebar or header).
  await page.getByRole("button", { name: /log ?out/i }).click();

  // Should redirect to the login page.
  await page.waitForURL(/#\/login/);
  await expect(page).toHaveURL(/#\/login/);

  // Navigating to a protected route should redirect back to login.
  await page.goto("/#/snapshots");
  await page.waitForURL(/#\/login/);
  await expect(page).toHaveURL(/#\/login/);
});

// ---------------------------------------------------------------------------
// 5. Auth-gated route protection
// ---------------------------------------------------------------------------

test.skip("@phase-c auth-guard: unauthenticated access to protected routes redirects to login", async ({
  page,
}) => {
  // TODO: activate when WEB-104 (login page + session flow) is done.
  const protectedRoutes = ["/#/snapshots", "/#/tags", "/#/schedules", "/#/import", "/#/settings"];

  for (const route of protectedRoutes) {
    await page.goto(route);
    await page.waitForURL(/#\/login/);
    await expect(page).toHaveURL(/#\/login/);
  }
});

test.skip("@phase-c auth-guard: authenticated user can access all routes", async ({ page }) => {
  // TODO: activate when WEB-104 (login page + session flow) is done.
  await loginViaUI(page);

  const routes = ["/#/", "/#/snapshots", "/#/tags", "/#/schedules", "/#/import", "/#/settings"];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page).not.toHaveURL(/#\/login/);
  }
});

// ---------------------------------------------------------------------------
// 6. API key CRUD — skipped until WEB-105 is done
// ---------------------------------------------------------------------------

test.skip("@phase-c api-keys: create a new API key and verify it appears in the list", async ({
  page,
}) => {
  // TODO: implement when WEB-105 (API key management page) is done.
  await loginViaUI(page);
  await page.goto("/#/settings/api-keys");

  await page.getByRole("button", { name: /new api key|create key|generate/i }).click();

  // Fill in key name if prompted.
  const nameInput = page.getByLabel(/key name|name/i);
  if (await nameInput.isVisible()) {
    await nameInput.fill("e2e-test-key");
    await page.getByRole("button", { name: /create|save/i }).click();
  }

  // The newly created key (or its name) should appear in the list.
  await expect(page.getByText("e2e-test-key")).toBeVisible();
});

test.skip("@phase-c api-keys: revoke an existing API key removes it from the list", async ({
  page,
  request,
}) => {
  // TODO: implement when WEB-105 (API key management page) is done.
  // Seed a key via API so the revoke test is independent of create.
  await request.post("http://localhost:3000/api/auth/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });

  await loginViaUI(page);
  await page.goto("/#/settings/api-keys");

  // Locate a key row and click its revoke/delete button.
  const revokeBtn = page.getByRole("button", { name: /revoke|delete/i }).first();
  await expect(revokeBtn).toBeVisible();
  await revokeBtn.click();

  // Confirm the deletion dialog if one appears.
  const confirmBtn = page.getByRole("button", { name: /confirm|yes|revoke/i });
  if (await confirmBtn.isVisible()) {
    await confirmBtn.click();
  }

  // The key entry should be gone.
  await expect(revokeBtn).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 7. First-run setup wizard — skipped until WEB-106 is done
// ---------------------------------------------------------------------------

test.skip("@phase-c setup-wizard: first-run wizard renders and accepts admin credentials", async ({
  page,
}) => {
  // TODO: implement when WEB-106 (first-run setup wizard) is done.
  // This test requires a fresh database with no admin user.
  await page.goto("/#/setup");

  await expect(page.getByRole("heading", { name: /welcome|setup|get started/i })).toBeVisible();

  // Fill in admin credentials.
  await page.getByLabel(/username/i).fill("newadmin");
  await page.getByLabel(/password/i).fill("SecurePass1!");
  await page.getByRole("button", { name: /next|create|finish|submit/i }).click();

  // Wizard should complete and redirect to login or dashboard.
  await expect(page).toHaveURL(/(#\/login|#\/|#\/snapshots)/);
});

test.skip("@phase-c setup-wizard: wizard is not accessible after admin user is created", async ({
  page,
}) => {
  // TODO: implement when WEB-106 (first-run setup wizard) is done.
  // Once admin exists, navigating to /setup should redirect away.
  await page.goto("/#/setup");
  await expect(page).not.toHaveURL(/#\/setup/);
});

// ---------------------------------------------------------------------------
// 8. Settings page — WEB-107 implemented
// ---------------------------------------------------------------------------

test("@phase-c settings: settings page renders with expected sections", async ({ page }) => {
  await loginViaUI(page);
  await page.goto("/#/settings");
  // Auth resolves asynchronously (getSetupStatus → getMe). networkidle can fire
  // before the auth useEffect starts its fetch, so use a generous assertion
  // timeout to let auth complete and the protected route re-render instead.
  await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible({ timeout: 15_000 });
  // At minimum the settings page should have an API keys section heading.
  await expect(page.getByRole("heading", { name: /api key/i })).toBeVisible();
});

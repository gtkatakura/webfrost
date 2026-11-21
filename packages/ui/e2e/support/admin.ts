import { join } from "node:path";

/** Admin account created by the first-run wizard in setup.spec.ts. */
export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "password123";

/** Signed-in session saved by setup.spec.ts and reused by the auth specs. */
export const ADMIN_STORAGE_STATE = join(__dirname, "../.auth/admin.json");

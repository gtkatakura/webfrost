import { type ServerInfo, WebFrostError } from "@webfrost/sdk";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useClient } from "../context";
import { useThemeContext } from "../context/theme";

const inputCls =
  "py-2 px-3 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 w-full";

const labelCls = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

export function SettingsPage() {
  const client = useClient();
  const { theme, toggle } = useThemeContext();

  // Server info
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);

  // Change password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    client
      .getServerInfo()
      .then(setServerInfo)
      .catch(() => {})
      .finally(() => setInfoLoading(false));
  }, [client]);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    setChangingPassword(true);
    try {
      await client.changePassword(currentPassword, newPassword);
      toast.success("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof WebFrostError ? err.message : String(err));
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8">Settings</h1>

      {/* API Keys */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">API Keys</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Manage API keys for programmatic access to WebFrost.
        </p>
        <Link
          to="/settings/api-keys"
          className="inline-block px-4 py-2 text-sm font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors no-underline"
        >
          Manage API Keys →
        </Link>
      </section>

      <hr className="border-gray-200 dark:border-gray-700 mb-10" />

      {/* Change Password */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          Change Password
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Update your admin account password.
        </p>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-4 max-w-sm">
          <div>
            <label htmlFor="current-password" className={labelCls}>
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="new-password" className={labelCls}>
              New password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className={labelCls}>
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={changingPassword}
              className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-0 cursor-pointer"
            >
              {changingPassword ? "Saving…" : "Change password"}
            </button>
          </div>
        </form>
      </section>

      <hr className="border-gray-200 dark:border-gray-700 mb-10" />

      {/* Preferences */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Preferences</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Customize the appearance of WebFrost.
        </p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-700 dark:text-gray-300">Theme</span>
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            {theme === "dark" ? "☀️ Switch to light" : "🌙 Switch to dark"}
          </button>
        </div>
      </section>

      <hr className="border-gray-200 dark:border-gray-700 mb-10" />

      {/* Server Info */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Server Info</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Information about this WebFrost instance.
        </p>
        {infoLoading ? (
          <div className="text-sm text-gray-400 dark:text-gray-500">Loading…</div>
        ) : serverInfo ? (
          <dl className="flex flex-col gap-2">
            <div className="flex gap-2 text-sm">
              <dt className="text-gray-500 dark:text-gray-400 w-36 shrink-0">Version</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-mono">{serverInfo.version}</dd>
            </div>
            <div className="flex gap-2 text-sm">
              <dt className="text-gray-500 dark:text-gray-400 w-36 shrink-0">Storage path</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-mono break-all">
                {serverInfo.storagePath}
              </dd>
            </div>
            <div className="flex gap-2 text-sm">
              <dt className="text-gray-500 dark:text-gray-400 w-36 shrink-0">Snapshots</dt>
              <dd className="text-gray-900 dark:text-gray-100">{serverInfo.snapshotCount}</dd>
            </div>
          </dl>
        ) : (
          <div className="text-sm text-gray-400 dark:text-gray-500">
            Unable to load server info.
          </div>
        )}
      </section>
    </main>
  );
}

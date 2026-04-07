import { useMutation, useQuery } from "@tanstack/react-query";
import { type ServerInfo, WebFrostError } from "@webfrost/sdk";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useClient } from "../context";
import { useThemeContext } from "../context/theme";

const inputCls =
  "py-2 px-3 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 w-full focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors";

const labelCls = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

function SettingCard({
  title,
  description,
  children,
}: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const client = useClient();
  const { theme, toggle } = useThemeContext();

  const { data: serverInfo, isPending: infoLoading } = useQuery<ServerInfo>({
    queryKey: ["server-info"],
    queryFn: () => client.getServerInfo(),
    retry: false,
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changePasswordMutation = useMutation({
    mutationFn: () => client.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast.success("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => toast.error(err instanceof WebFrostError ? err.message : String(err)),
  });

  const changingPassword = changePasswordMutation.isPending;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    changePasswordMutation.mutate();
  }

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Settings</h1>

      <div className="flex flex-col gap-5">
        <SettingCard
          title="API Keys"
          description="Manage API keys for programmatic access to WebFrost."
        >
          <Link
            to="/settings/api-keys"
            className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors no-underline"
          >
            Manage API Keys →
          </Link>
        </SettingCard>

        <SettingCard title="Change Password" description="Update your admin account password.">
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
                className="px-4 py-2 text-sm font-semibold rounded-md bg-primary text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-0 cursor-pointer"
              >
                {changingPassword ? "Saving…" : "Change password"}
              </button>
            </div>
          </form>
        </SettingCard>

        <SettingCard title="Appearance" description="Customize the look of WebFrost.">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-700 dark:text-gray-300">Theme</span>
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
            >
              {theme === "dark" ? (
                <>
                  <Sun size={14} /> Switch to light
                </>
              ) : (
                <>
                  <Moon size={14} /> Switch to dark
                </>
              )}
            </button>
          </div>
        </SettingCard>

        <SettingCard title="Server Info" description="Information about this WebFrost instance.">
          {infoLoading ? (
            <div className="text-sm text-gray-400 dark:text-gray-500">Loading…</div>
          ) : serverInfo ? (
            <dl className="flex flex-col gap-3">
              {[
                { label: "Version", value: serverInfo.version },
                { label: "Storage path", value: serverInfo.storagePath },
                { label: "Snapshots", value: String(serverInfo.snapshotCount) },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-4 text-sm">
                  <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">{label}</dt>
                  <dd className="text-gray-900 dark:text-gray-100 font-mono break-all">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="text-sm text-gray-400 dark:text-gray-500">
              Unable to load server info.
            </div>
          )}
        </SettingCard>
      </div>
    </main>
  );
}

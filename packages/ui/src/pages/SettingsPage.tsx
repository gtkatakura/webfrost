import { useMutation, useQuery } from "@tanstack/react-query";
import type { ServerInfo } from "@webfrost/sdk";
import { ChevronRight, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button, buttonClasses } from "../components/ui/Button";
import { PageHeader, Skeleton } from "../components/ui/StateViews";
import { TextField } from "../components/ui/TextField";
import { useClient } from "../context";
import { useThemeContext } from "../context/theme";
import { errorMessage } from "../lib/errors";

function SettingCard({
  title,
  description,
  children,
}: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-4 border-b border-border py-6 last:border-b-0 md:grid-cols-[14rem_minmax(0,1fr)]">
      <div>
        <h2 className="m-0 text-ui-lg font-semibold text-high">{title}</h2>
        {description && <p className="mb-0 mt-1 text-ui-sm text-mid">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
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

  const changePassword = useMutation({
    mutationFn: () => client.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast.success("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    changePassword.mutate();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Settings" />

      <div className="rounded-xl border border-border bg-surface px-5 sm:px-6">
        <SettingCard
          title="API Keys"
          description="Manage API keys for programmatic access to WebFrost."
        >
          <Link to="/settings/api-keys" className={buttonClasses("secondary", "md")}>
            Manage API Keys
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </SettingCard>

        <SettingCard title="Change Password" description="Update your admin account password.">
          <form onSubmit={handleChangePassword} className="flex max-w-sm flex-col gap-4">
            <TextField
              label="Current password"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <TextField
              label="New password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              hint="At least 8 characters."
            />
            <TextField
              label="Confirm new password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <div>
              <Button type="submit" disabled={changePassword.isPending}>
                {changePassword.isPending ? "Saving…" : "Change password"}
              </Button>
            </div>
          </form>
        </SettingCard>

        <SettingCard title="Appearance" description="Customize the look of WebFrost.">
          <div className="flex items-center gap-3">
            <span className="text-ui-sm text-mid">Theme</span>
            <Button variant="secondary" onClick={toggle}>
              {theme === "dark" ? (
                <>
                  <Sun size={14} aria-hidden="true" /> Switch to light
                </>
              ) : (
                <>
                  <Moon size={14} aria-hidden="true" /> Switch to dark
                </>
              )}
            </Button>
          </div>
        </SettingCard>

        <SettingCard title="Server Info" description="Information about this WebFrost instance.">
          {infoLoading ? (
            <div className="flex flex-col gap-2.5" role="status" aria-label="Loading server info">
              {["w-16", "w-72", "w-10"].map((w) => (
                <div
                  key={w}
                  className="flex flex-col gap-1.5 py-0.5 sm:flex-row sm:items-center sm:gap-4"
                >
                  <Skeleton className="h-3 w-20 shrink-0 sm:w-24" />
                  <Skeleton className={`h-3 max-w-full ${w}`} />
                </div>
              ))}
            </div>
          ) : serverInfo ? (
            <dl className="m-0 flex flex-col gap-2.5">
              {[
                { label: "Version", value: serverInfo.version },
                { label: "Storage path", value: serverInfo.storagePath },
                { label: "Snapshots", value: String(serverInfo.snapshotCount) },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5 text-ui-sm sm:flex-row sm:gap-4">
                  <dt className="shrink-0 text-mid sm:w-28">{label}</dt>
                  <dd className="m-0 break-all font-mono text-high">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p role="alert" className="m-0 text-ui-base text-danger">
              Unable to load server info.
            </p>
          )}
        </SettingCard>
      </div>
    </main>
  );
}

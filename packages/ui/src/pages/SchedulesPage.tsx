import { WebFrostError } from "@webfrost/sdk";
import type { Schedule } from "@webfrost/sdk";
import { CalendarClock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useClient } from "../context";

const PRESETS = [
  { label: "— pick preset —", value: "" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
  { label: "Daily (midnight)", value: "0 0 * * *" },
  { label: "Weekly (Sunday)", value: "0 0 * * 0" },
];

const CRON_LABELS: Record<string, string> = {
  "0 * * * *": "Hourly",
  "0 */6 * * *": "Every 6 hours",
  "0 */12 * * *": "Every 12 hours",
  "0 0 * * *": "Daily",
  "0 0 * * 0": "Weekly",
};

function describeCron(cron: string): string {
  return CRON_LABELS[cron] ?? cron;
}

function formatDate(val: string | null): string {
  if (!val) return "—";
  return new Date(val).toLocaleString();
}

const inputCls =
  "py-2 px-3 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100";

export function SchedulesPage() {
  const client = useClient();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [cron, setCron] = useState("");
  const [creating, setCreating] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const data = await client.listSchedules();
      setSchedules(data);
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !cron.trim()) return;
    setCreating(true);
    try {
      const created = await client.createSchedule(url.trim(), cron.trim());
      setSchedules((prev) => [...prev, created]);
      setUrl("");
      setCron("");
      toast.success("Schedule created");
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this schedule?")) return;
    try {
      await client.deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      toast.success("Schedule deleted");
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
    }
  }

  return (
    <main className="max-w-[900px] mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">Schedules</h1>

      <form onSubmit={handleCreate} className="flex flex-wrap gap-2 mb-6 items-end">
        <label className="flex flex-col gap-1 flex-1 min-w-[200px] text-xs text-gray-500 dark:text-gray-400 font-medium">
          URL
          <input
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400 font-medium">
          Preset
          <select
            className={inputCls}
            value={PRESETS.find((p) => p.value === cron)?.value ?? ""}
            onChange={(e) => {
              if (e.target.value) setCron(e.target.value);
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400 font-medium">
          Cron expression
          <input
            type="text"
            placeholder="0 * * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            required
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className={`py-2 px-5 bg-primary text-white border-0 rounded font-semibold ${
            creating ? "cursor-not-allowed opacity-70" : "cursor-pointer"
          }`}
        >
          {creating ? "Creating…" : "Add schedule"}
        </button>
      </form>

      {loading ? (
        <p className="text-gray-400 dark:text-gray-500">Loading…</p>
      ) : schedules.length === 0 ? (
        <div className="text-center mt-16 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <CalendarClock size={28} className="text-gray-400 dark:text-gray-500" />
          </div>
          <div>
            <p className="text-gray-700 dark:text-gray-300 font-semibold">No schedules yet</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
              Add a schedule above to automatically archive URLs on a recurring basis.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4 font-medium">URL</th>
                <th className="py-2 pr-4 font-medium">Schedule</th>
                <th className="py-2 pr-4 font-medium">Last run</th>
                <th className="py-2 pr-4 font-medium">Next run</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td className="py-2.5 pr-4 max-w-[240px] truncate">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                      title={s.url}
                    >
                      {s.url}
                    </a>
                  </td>
                  <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300">
                    {describeCron(s.cron)}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-500 dark:text-gray-400">
                    {formatDate(s.lastRunAt)}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-500 dark:text-gray-400">
                    {formatDate(s.nextRunAt)}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-500 dark:text-gray-400">
                    {formatDate(s.createdAt)}
                  </td>
                  <td className="py-2.5">
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      className="bg-transparent border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded cursor-pointer py-1 px-2.5 text-xs hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

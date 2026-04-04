import { WebFrostError } from "@webfrost/sdk";
import type { Schedule } from "@webfrost/sdk";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../components";
import { useClient } from "../context";

// ─── Cron parsing ─────────────────────────────────────────────────────────────

const CRON_LABELS: Record<string, string> = {
  "0 * * * *": "Hourly",
  "0 */6 * * *": "Every 6 h",
  "0 */12 * * *": "Every 12 h",
  "0 0 * * *": "Daily",
  "0 0 * * 0": "Weekly",
};

const PRESETS = [
  { label: "— pick preset —", value: "" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
  { label: "Daily (midnight)", value: "0 0 * * *" },
  { label: "Weekly (Sunday)", value: "0 0 * * 0" },
];

function parseCronField(field: string, min: number, max: number): number[] | null {
  if (field === "*") return null;
  if (field.startsWith("*/")) {
    const step = Math.max(1, Number.parseInt(field.slice(2), 10));
    const result: number[] = [];
    for (let i = min; i <= max; i += step) result.push(i);
    return result;
  }
  if (field.includes(",")) return field.split(",").map(Number);
  return [Number.parseInt(field, 10)];
}

function getNextTimes(cron: string, count: number): Date[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  const [minuteF, hourF, domF, monthF, dowF] = parts;
  const minutes = parseCronField(minuteF, 0, 59);
  const hours = parseCronField(hourF, 0, 23);
  const doms = parseCronField(domF, 1, 31);
  const months = parseCronField(monthF, 1, 12);
  const dows = parseCronField(dowF, 0, 6);

  const results: Date[] = [];
  const cursor = new Date();
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  let iterations = 0;
  while (results.length < count && iterations < 200_000) {
    iterations++;
    const mo = cursor.getMonth() + 1;
    const monthOk = !months || months.includes(mo);
    const domOk = !doms || doms.includes(cursor.getDate());
    const dowOk = !dows || dows.includes(cursor.getDay());
    const hourOk = !hours || hours.includes(cursor.getHours());
    const minuteOk = !minutes || minutes.includes(cursor.getMinutes());
    if (monthOk && domOk && dowOk && hourOk && minuteOk) results.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return results;
}

function describeCron(cron: string): string {
  return CRON_LABELS[cron] ?? cron;
}

// ─── Time utilities ────────────────────────────────────────────────────────────

function relativeTime(val: string | null): string {
  if (!val) return "—";
  const diff = Date.now() - new Date(val).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const prefix = future ? "in " : "";
  const suffix = future ? "" : " ago";
  if (abs < 60_000) return `${prefix}just now${suffix}`;
  if (abs < 3_600_000) return `${prefix}${Math.round(abs / 60_000)}m${suffix}`;
  if (abs < 86_400_000) return `${prefix}${Math.round(abs / 3_600_000)}h${suffix}`;
  return `${prefix}${Math.round(abs / 86_400_000)}d${suffix}`;
}

function shortDate(date: Date): string {
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Health indicator ─────────────────────────────────────────────────────────

type HealthState = "ok" | "overdue" | "never";

function getHealth(schedule: Schedule): HealthState {
  if (!schedule.lastRunAt) return "never";
  if (schedule.nextRunAt && new Date(schedule.nextRunAt) < new Date(Date.now() - 60_000)) {
    return "overdue";
  }
  return "ok";
}

const healthConfig: Record<HealthState, { label: string; dot: string; text: string }> = {
  ok: { label: "On schedule", dot: "var(--status-success)", text: "var(--status-success)" },
  overdue: { label: "Overdue", dot: "var(--status-warning)", text: "var(--status-warning)" },
  never: { label: "Never run", dot: "var(--text-low)", text: "var(--text-low)" },
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function HealthBadge({ schedule }: { schedule: Schedule }) {
  const h = getHealth(schedule);
  const cfg = healthConfig[h];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 500,
        color: cfg.text,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: cfg.dot,
          flexShrink: 0,
          ...(h === "ok"
            ? { boxShadow: `0 0 0 2px color-mix(in srgb, ${cfg.dot} 25%, transparent)` }
            : {}),
        }}
      />
      {cfg.label}
    </span>
  );
}

function CronPreview({ cron }: { cron: string }) {
  const times = useMemo(() => getNextTimes(cron, 5), [cron]);
  const [expanded, setExpanded] = useState(false);

  if (times.length === 0) return null;

  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--text-low)",
          fontSize: 11,
        }}
      >
        <Clock size={10} />
        Next: {shortDate(times[0])}
        {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {expanded && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 4,
          }}
        >
          {times.map((t) => (
            <span
              key={t.getTime()}
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-overlay)",
                color: "var(--text-mid)",
                fontFamily: "ui-monospace, monospace",
                whiteSpace: "nowrap",
              }}
            >
              {shortDate(t)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  schedule,
  onDelete,
}: {
  schedule: Schedule;
  onDelete: (id: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <tr
      style={{
        borderBottom: "1px solid var(--border-default)",
      }}
      className="group"
    >
      {/* URL */}
      <td style={{ padding: "10px 12px 10px 0", maxWidth: 220, verticalAlign: "top" }}>
        <a
          href={schedule.url}
          target="_blank"
          rel="noreferrer"
          title={schedule.url}
          style={{
            color: "var(--text-high)",
            textDecoration: "none",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            fontWeight: 500,
          }}
          className="hover:text-accent"
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
            }}
          >
            {schedule.url.replace(/^https?:\/\//, "")}
          </span>
          <ExternalLink
            size={11}
            style={{ flexShrink: 0, color: "var(--text-low)", opacity: 0 }}
            className="group-hover:opacity-100"
          />
        </a>
        <div
          style={{ fontSize: 11, color: "var(--text-low)", marginTop: 2, fontFamily: "monospace" }}
        >
          {schedule.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
        </div>
      </td>

      {/* Schedule + cron preview */}
      <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top", minWidth: 160 }}>
        <div style={{ fontSize: 13, color: "var(--text-high)", fontWeight: 500 }}>
          {describeCron(schedule.cron)}
        </div>
        <div
          style={{ fontSize: 11, color: "var(--text-low)", fontFamily: "monospace", marginTop: 1 }}
        >
          {schedule.cron !== describeCron(schedule.cron) ? null : schedule.cron}
        </div>
        <CronPreview cron={schedule.cron} />
      </td>

      {/* Health */}
      <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top" }}>
        <HealthBadge schedule={schedule} />
      </td>

      {/* Last run */}
      <td
        style={{
          padding: "10px 12px 10px 0",
          verticalAlign: "top",
          fontSize: 12,
          color: "var(--text-mid)",
          whiteSpace: "nowrap",
        }}
      >
        {relativeTime(schedule.lastRunAt)}
      </td>

      {/* Next run */}
      <td
        style={{
          padding: "10px 12px 10px 0",
          verticalAlign: "top",
          fontSize: 12,
          color: "var(--text-mid)",
          whiteSpace: "nowrap",
        }}
      >
        {relativeTime(schedule.nextRunAt)}
      </td>

      {/* Actions */}
      <td style={{ padding: "10px 0", verticalAlign: "top" }}>
        {confirmDelete ? (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => onDelete(schedule.id)}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 4,
                background: "var(--status-danger)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 4,
                background: "none",
                color: "var(--text-mid)",
                border: "1px solid var(--border-default)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            title="Delete schedule"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-low)",
              padding: 4,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              opacity: 0,
              transition: "opacity 150ms, color 150ms",
            }}
            className="group-hover:opacity-100 hover:!text-danger"
          >
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Add schedule form ─────────────────────────────────────────────────────────

function AddScheduleForm({
  onCreated,
}: {
  onCreated: (s: Schedule) => void;
}) {
  const client = useClient();
  const [url, setUrl] = useState("");
  const [cron, setCron] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !cron.trim()) return;
    setCreating(true);
    try {
      const created = await client.createSchedule(url.trim(), cron.trim());
      onCreated(created);
      setUrl("");
      setCron("");
      toast.success("Schedule created");
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px",
    border: "1px solid var(--border-default)",
    borderRadius: 6,
    fontSize: 13,
    background: "var(--bg-surface)",
    color: "var(--text-high)",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    color: "var(--text-mid)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 10,
        padding: "16px 20px",
        marginBottom: 24,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text-mid)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 12,
        }}
      >
        New schedule
      </div>
      <form
        onSubmit={handleCreate}
        style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}
      >
        <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
          URL
          <input
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Preset
          <select
            style={{ ...inputStyle, width: "auto" }}
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
        <label style={labelStyle}>
          Cron expression
          <input
            type="text"
            placeholder="0 * * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            required
            style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", width: 160 }}
          />
        </label>
        <Button variant="primary" size="md" type="submit" disabled={creating}>
          <Plus size={14} />
          {creating ? "Creating…" : "Add schedule"}
        </Button>
      </form>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function SchedulesPage() {
  const client = useClient();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function handleDelete(id: number) {
    try {
      await client.deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      toast.success("Schedule deleted");
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
    }
  }

  const activeCount = schedules.filter((s) => s.nextRunAt !== null).length;

  return (
    <main style={{ maxWidth: 940, margin: "0 auto", padding: "32px 20px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <CalendarClock size={20} style={{ color: "var(--accent)" }} />
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 600,
            color: "var(--text-high)",
            lineHeight: 1.2,
          }}
        >
          Schedules
        </h1>
        {!loading && schedules.length > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 10,
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              color: "var(--accent)",
              marginLeft: 2,
            }}
          >
            {activeCount} active
          </span>
        )}
      </div>

      {/* Add form */}
      <AddScheduleForm onCreated={(s) => setSchedules((prev) => [...prev, s])} />

      {/* Table / empty state */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 56,
                borderRadius: 8,
                background: "var(--bg-overlay)",
                animation: "pulse 1.5s ease-in-out infinite",
                opacity: 0.6,
              }}
            />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: "64px 0",
            color: "var(--text-low)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--bg-overlay)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CalendarClock size={24} style={{ color: "var(--text-low)" }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-mid)" }}>
              No schedules yet
            </div>
            <div style={{ fontSize: 13, color: "var(--text-low)", marginTop: 4 }}>
              Add a schedule above to automatically archive URLs on a recurring basis.
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border-default)",
                    background: "var(--bg-overlay)",
                  }}
                >
                  {["URL", "Schedule", "Health", "Last run", "Next run", ""].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 12px 8px 0",
                        textAlign: "left",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--text-low)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <ScheduleRow key={s.id} schedule={s} onDelete={handleDelete} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

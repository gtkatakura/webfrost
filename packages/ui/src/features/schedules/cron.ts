import type { Schedule } from "@webfrost/sdk";

export const SCHEDULE_KEYS = {
  all: ["schedules"] as const,
  list: () => ["schedules", "list"] as const,
};

const CRON_LABELS: Record<string, string> = {
  "0 * * * *": "Hourly",
  "0 */6 * * *": "Every 6 h",
  "0 */12 * * *": "Every 12 h",
  "0 0 * * *": "Daily",
  "0 0 * * 0": "Weekly",
};

export const PRESETS = [
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

/** The next `count` run times of a 5-field cron expression, for the preview under each schedule. */
export function getNextTimes(cron: string, count: number): Date[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  const [minuteF = "*", hourF = "*", domF = "*", monthF = "*", dowF = "*"] = parts;
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
    const monthOk = !months || months.includes(cursor.getMonth() + 1);
    const domOk = !doms || doms.includes(cursor.getDate());
    const dowOk = !dows || dows.includes(cursor.getDay());
    const hourOk = !hours || hours.includes(cursor.getHours());
    const minuteOk = !minutes || minutes.includes(cursor.getMinutes());
    if (monthOk && domOk && dowOk && hourOk && minuteOk) results.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return results;
}

const TWO_DIGITS = /^\d{1,2}$/;

/**
 * A short label for a cron expression: the preset name, "Daily at 06:30" or "Hourly at :15" for
 * the two common hand-written shapes, and the expression itself for anything else.
 */
export function describeCron(cron: string): string {
  const expr = cron.trim().replace(/\s+/g, " ");
  const preset = CRON_LABELS[expr];
  if (preset) return preset;
  const [minute = "", hour = "", ...rest] = expr.split(" ");
  if (rest.length !== 3 || rest.some((f) => f !== "*") || !TWO_DIGITS.test(minute)) return cron;
  const m = Number(minute);
  if (m > 59) return cron;
  if (hour === "*") return `Hourly at :${String(m).padStart(2, "0")}`;
  if (!TWO_DIGITS.test(hour) || Number(hour) > 23) return cron;
  return `Daily at ${hour.padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function shortDate(date: Date): string {
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export type HealthState = "ok" | "overdue" | "never";

export function getHealth(schedule: Schedule): HealthState {
  if (!schedule.lastRunAt) return "never";
  if (schedule.nextRunAt && new Date(schedule.nextRunAt) < new Date(Date.now() - 60_000)) {
    return "overdue";
  }
  return "ok";
}

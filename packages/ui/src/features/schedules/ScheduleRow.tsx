import type { Schedule } from "@webfrost/sdk";
import { ChevronDown, ChevronUp, Clock, ExternalLink, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { relativeTime } from "../../lib/format";
import { type HealthState, describeCron, getHealth, getNextTimes, shortDate } from "./cron";

const HEALTH: Record<HealthState, { label: string; dot: string; text: string }> = {
  ok: { label: "On schedule", dot: "bg-success", text: "text-success" },
  overdue: { label: "Overdue", dot: "bg-warning", text: "text-warning" },
  never: { label: "Never run", dot: "bg-low", text: "text-mid" },
};

function HealthBadge({ schedule }: { schedule: Schedule }) {
  const cfg = HEALTH[getHealth(schedule)];
  return (
    <span className={`inline-flex items-center gap-1.5 text-ui-xs font-medium ${cfg.text}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />
      {cfg.label}
    </span>
  );
}

function CronPreview({ cron }: { cron: string }) {
  const times = useMemo(() => getNextTimes(cron, 5), [cron]);
  const [expanded, setExpanded] = useState(false);
  if (times.length === 0 || !times[0]) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-ui-xs text-mid hover:text-high"
      >
        <Clock size={10} aria-hidden="true" />
        Next: {shortDate(times[0])}
        {expanded ? (
          <ChevronUp size={10} aria-hidden="true" />
        ) : (
          <ChevronDown size={10} aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <div className="mt-1 flex flex-wrap gap-1">
          {times.map((t) => (
            <span
              key={t.getTime()}
              className="whitespace-nowrap rounded bg-overlay px-1.5 py-px font-mono text-ui-xs text-mid"
            >
              {shortDate(t)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const td = "py-2.5 pr-3 align-top";

export function ScheduleRow({
  schedule,
  onDelete,
}: {
  schedule: Schedule;
  onDelete: (id: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const label = describeCron(schedule.cron);

  return (
    <tr className="group border-b border-border last:border-b-0">
      <td className={`${td} max-w-56 pl-4`}>
        <a
          href={schedule.url}
          target="_blank"
          rel="noreferrer"
          title={schedule.url}
          className="flex items-center gap-1 text-ui-base font-medium text-high no-underline hover:text-accent hover:no-underline"
        >
          <span className="block truncate">{schedule.url.replace(/^https?:\/\//, "")}</span>
          <ExternalLink
            size={11}
            className="shrink-0 text-low opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-hidden="true"
          />
        </a>
        <div className="mt-0.5 truncate font-mono text-ui-xs text-low">
          {schedule.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
        </div>
      </td>

      <td className={`${td} min-w-40`}>
        <div className="text-ui-base font-medium text-high">{label}</div>
        {schedule.cron !== label && (
          <div className="mt-px font-mono text-ui-xs text-low">{schedule.cron}</div>
        )}
        <CronPreview cron={schedule.cron} />
      </td>

      <td className={td}>
        <HealthBadge schedule={schedule} />
      </td>
      <td className={`${td} whitespace-nowrap text-ui-sm text-mid`}>
        {relativeTime(schedule.lastRunAt)}
      </td>
      <td className={`${td} whitespace-nowrap text-ui-sm text-mid`}>
        {relativeTime(schedule.nextRunAt)}
      </td>

      <td className={`${td} pr-4`}>
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onDelete(schedule.id)}
              className="rounded border-0 bg-danger px-2 py-1 text-ui-xs font-medium text-danger-fg hover:opacity-90"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded border border-border bg-transparent px-2 py-1 text-ui-xs text-mid hover:bg-subtle hover:text-high"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            title="Delete schedule"
            aria-label="Delete schedule"
            className="flex rounded border-0 bg-transparent p-1 text-low transition-colors hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 sm:opacity-0"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}

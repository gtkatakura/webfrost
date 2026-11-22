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
    <span className={`inline-flex items-center gap-1.5 text-ui-sm font-medium ${cfg.text}`}>
      <span className={`size-2 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />
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
        className="inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 text-ui-xs text-mid hover:text-high"
      >
        <Clock size={12} aria-hidden="true" />
        Next: {shortDate(times[0])}
        {expanded ? (
          <ChevronUp size={12} aria-hidden="true" />
        ) : (
          <ChevronDown size={12} aria-hidden="true" />
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

// Below sm a row is a stacked card: the table cells become blocks and the run columns carry
// their own labels (the header row is hidden there).
const td = "block sm:table-cell sm:py-3 sm:pr-3 sm:align-top";
const cellLabel = "label-caps mb-0.5 block sm:hidden";

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
    <tr className="group relative grid grid-cols-3 gap-x-3 gap-y-2.5 border-b border-border px-4 py-3.5 last:border-b-0 sm:table-row sm:p-0">
      <td className={`${td} col-span-3 min-w-0 pr-20 sm:max-w-64 sm:pl-4`}>
        <a
          href={schedule.url}
          target="_blank"
          rel="noreferrer"
          title={schedule.url}
          className="flex items-center gap-1 text-ui-base font-medium text-high no-underline hover:text-accent hover:no-underline"
        >
          <span className="block truncate">{schedule.url.replace(/^https?:\/\//, "")}</span>
          <ExternalLink
            size={12}
            className="shrink-0 text-low sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
            aria-hidden="true"
          />
        </a>
        <div className="mt-0.5 truncate font-mono text-ui-xs text-low">
          {schedule.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
        </div>
      </td>

      <td className={`${td} col-span-3 sm:min-w-40`}>
        <div className="text-ui-base font-medium text-high">{label}</div>
        {schedule.cron !== label && (
          <div className="mt-px font-mono text-ui-xs text-low">{schedule.cron}</div>
        )}
        <CronPreview cron={schedule.cron} />
      </td>

      <td className={td}>
        <span className={cellLabel}>Health</span>
        <HealthBadge schedule={schedule} />
      </td>
      <td className={`${td} whitespace-nowrap text-ui-sm tabular-nums text-mid`}>
        <span className={cellLabel}>Last run</span>
        {relativeTime(schedule.lastRunAt)}
      </td>
      <td className={`${td} whitespace-nowrap text-ui-sm tabular-nums text-mid`}>
        <span className={cellLabel}>Next run</span>
        {relativeTime(schedule.nextRunAt)}
      </td>

      <td className={`${td} absolute right-3 top-3 sm:static sm:pr-4 sm:text-right`}>
        {confirmDelete ? (
          <div className="flex items-center justify-end gap-1 bg-surface pl-2 sm:pl-0">
            <button
              type="button"
              onClick={() => onDelete(schedule.id)}
              className="h-8 rounded-md border-0 bg-danger px-2.5 text-ui-xs font-medium text-danger-fg hover:opacity-90"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-8 rounded-md border border-border bg-surface px-2.5 text-ui-xs text-mid hover:bg-subtle hover:text-high"
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
            className="ml-auto inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-low transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}

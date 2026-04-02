/**
 * Minimal 5-field cron expression parser and next-run calculator.
 * Format: minute hour day-of-month month day-of-week
 * Supports: *, *\/n (step), n (literal), n-m (range), n,m (list)
 */

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.startsWith("*/")) {
      const step = Number.parseInt(part.slice(2), 10);
      if (Number.isNaN(step) || step < 1) throw new Error(`Invalid step in cron field: ${part}`);
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (part.includes("-")) {
      const dash = part.indexOf("-");
      const start = Number.parseInt(part.slice(0, dash), 10);
      const end = Number.parseInt(part.slice(dash + 1), 10);
      if (Number.isNaN(start) || Number.isNaN(end))
        throw new Error(`Invalid range in cron field: ${part}`);
      for (let i = start; i <= end; i++) values.add(i);
    } else {
      const n = Number.parseInt(part, 10);
      if (Number.isNaN(n)) throw new Error(`Invalid value in cron field: ${part}`);
      values.add(n);
    }
  }
  return values;
}

/** Parse and validate a 5-field cron expression. Throws on invalid input. */
export function parseCron(cron: string): {
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number>;
  months: Set<number>;
  dows: Set<number>;
} {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields (got ${parts.length}): "${cron}"`);
  }
  const [minF, hourF, domF, monF, dowF] = parts as [string, string, string, string, string];
  return {
    minutes: parseField(minF, 0, 59),
    hours: parseField(hourF, 0, 23),
    doms: parseField(domF, 1, 31),
    months: parseField(monF, 1, 12),
    dows: parseField(dowF, 0, 6),
  };
}

/**
 * Compute the next Date when the cron fires after `from`.
 * Iterates minute-by-minute (max ~2 years).
 */
export function nextCronDate(cron: string, from: Date): Date {
  const { minutes, hours, doms, months, dows } = parseCron(cron);

  // Start one minute ahead of `from`
  const candidate = new Date(from);
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Max iterations: 2 years of minutes
  const maxIter = 60 * 24 * 366 * 2;
  for (let i = 0; i < maxIter; i++) {
    const m = candidate.getMinutes();
    const h = candidate.getHours();
    const dom = candidate.getDate();
    const mon = candidate.getMonth() + 1; // 1-12
    const dow = candidate.getDay(); // 0=Sunday

    if (minutes.has(m) && hours.has(h) && doms.has(dom) && months.has(mon) && dows.has(dow)) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`Could not find next run date within 2 years for cron: "${cron}"`);
}

/**
 * 5-field cron expression parser and next-run calculator.
 *
 * Format: minute hour day-of-month month day-of-week
 *
 * Per field: `*`, `n`, `n-m`, `*\/s`, `n-m/s`, `n/s` and comma lists of those.
 * Month (JAN-DEC) and weekday (SUN-SAT) names work in any case. Weekday 7 is
 * Sunday. The aliases @hourly, @daily (@midnight), @weekly, @monthly and
 * @yearly (@annually) are accepted.
 *
 * Day-of-month and day-of-week follow Vixie cron: when both are restricted
 * (neither starts with `*`) a day matches if EITHER does; otherwise both must.
 *
 * Time zone: expressions are evaluated in the process time zone (the TZ
 * environment variable). Across DST changes a wall-clock time that does not
 * exist (spring forward) is skipped for that day, and one that occurs twice
 * (fall back) fires once, on its first occurrence.
 */

/** Thrown for an invalid cron expression. The message always mentions "cron". */
export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronError";
  }
}

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const DOW_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const ALIASES: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  /** Names mapped to `nameBase + index`. */
  names?: string[];
  nameBase?: number;
}

function parseValue(token: string, spec: FieldSpec, part: string): number {
  let n: number;
  if (/^\d+$/.test(token)) {
    n = Number.parseInt(token, 10);
  } else if (spec.names) {
    const idx = spec.names.indexOf(token.toUpperCase());
    if (idx < 0) {
      throw new CronError(`Invalid cron ${spec.name} field "${part}": unknown value "${token}"`);
    }
    n = idx + (spec.nameBase ?? 0);
  } else {
    throw new CronError(`Invalid cron ${spec.name} field "${part}": unknown value "${token}"`);
  }
  if (n < spec.min || n > spec.max) {
    throw new CronError(
      `Invalid cron ${spec.name} field "${part}": ${n} is out of range ${spec.min}-${spec.max}`,
    );
  }
  return n;
}

function parseField(field: string, spec: FieldSpec): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "") throw new CronError(`Invalid cron ${spec.name} field "${field}": empty item`);
    const [rangePart = "", stepPart, ...extra] = part.split("/");
    if (extra.length > 0) {
      throw new CronError(`Invalid cron ${spec.name} field "${part}": too many "/"`);
    }
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number.parseInt(stepPart, 10) < 1) {
        throw new CronError(`Invalid cron ${spec.name} field "${part}": step must be 1 or more`);
      }
      step = Number.parseInt(stepPart, 10);
    }

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = spec.min;
      end = spec.max;
    } else if (rangePart.includes("-")) {
      const [a = "", b = "", ...more] = rangePart.split("-");
      if (more.length > 0 || a === "" || b === "") {
        throw new CronError(`Invalid cron ${spec.name} field "${part}": malformed range`);
      }
      start = parseValue(a, spec, part);
      end = parseValue(b, spec, part);
      if (start > end) {
        throw new CronError(
          `Invalid cron ${spec.name} field "${part}": range start is after its end`,
        );
      }
    } else {
      start = parseValue(rangePart, spec, part);
      // "n/s" means "from n to the maximum, every s"; plain "n" is just n.
      end = stepPart !== undefined ? spec.max : start;
    }
    for (let i = start; i <= end; i += step) values.add(i);
  }
  return values;
}

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number>;
  months: Set<number>;
  /** 0-6, Sunday = 0 (a 7 in the expression is folded into 0). */
  dows: Set<number>;
  /** True when the day-of-month field starts with `*` (unrestricted). */
  domWildcard: boolean;
  /** True when the day-of-week field starts with `*` (unrestricted). */
  dowWildcard: boolean;
}

/** Parse and validate a 5-field cron expression. Throws CronError on invalid input. */
export function parseCron(cron: string): ParsedCron {
  let expr = cron.trim();
  if (expr.startsWith("@")) {
    const alias = ALIASES[expr.toLowerCase()];
    if (!alias) throw new CronError(`Unknown cron alias "${expr}"`);
    expr = alias;
  }
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(`Cron expression must have 5 fields (got ${parts.length}): "${cron}"`);
  }
  const [minF, hourF, domF, monF, dowF] = parts as [string, string, string, string, string];
  const dows = parseField(dowF, {
    name: "day-of-week",
    min: 0,
    max: 7,
    names: DOW_NAMES,
    nameBase: 0,
  });
  if (dows.delete(7)) dows.add(0);
  return {
    minutes: parseField(minF, { name: "minute", min: 0, max: 59 }),
    hours: parseField(hourF, { name: "hour", min: 0, max: 23 }),
    doms: parseField(domF, { name: "day-of-month", min: 1, max: 31 }),
    months: parseField(monF, { name: "month", min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 }),
    dows,
    domWildcard: domF.startsWith("*"),
    dowWildcard: dowF.startsWith("*"),
  };
}

const MINUTE = 60_000;

/** True when `d` shows a wall-clock time that already occurred earlier (DST fall back). */
function isRepeatedWallTime(d: Date): boolean {
  for (const back of [30, 60]) {
    const prev = new Date(d.getTime() - back * MINUTE);
    if (
      prev.getHours() === d.getHours() &&
      prev.getMinutes() === d.getMinutes() &&
      prev.getDate() === d.getDate()
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Compute the next Date, strictly after `from`, when the cron fires, in the
 * process time zone. Throws CronError for an invalid expression or when no run
 * exists within about 5 years (for example `0 0 31 2 *`).
 */
export function nextCronDate(cron: string, from: Date): Date {
  const p = parseCron(cron);
  const useOr = !p.domWildcard && !p.dowWildcard;

  const c = new Date(from);
  c.setSeconds(0, 0);
  c.setTime(c.getTime() + MINUTE);

  const limit = from.getTime() + 5 * 366 * 24 * 60 * MINUTE;
  while (c.getTime() <= limit) {
    if (!p.months.has(c.getMonth() + 1)) {
      // Jump to local midnight on the 1st of the next month.
      c.setTime(new Date(c.getFullYear(), c.getMonth() + 1, 1).getTime());
      continue;
    }
    const domOk = p.doms.has(c.getDate());
    const dowOk = p.dows.has(c.getDay());
    const dayOk = useOr ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) {
      c.setTime(new Date(c.getFullYear(), c.getMonth(), c.getDate() + 1).getTime());
      continue;
    }
    if (!p.hours.has(c.getHours())) {
      // Jump to the start of the next hour (absolute time, DST-safe).
      c.setTime(c.getTime() + (60 - c.getMinutes()) * MINUTE);
      continue;
    }
    if (p.minutes.has(c.getMinutes()) && !isRepeatedWallTime(c)) {
      return new Date(c);
    }
    c.setTime(c.getTime() + MINUTE);
  }

  throw new CronError(`Could not find a next run date within 5 years for cron: "${cron}"`);
}

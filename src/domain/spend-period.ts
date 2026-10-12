/** Spend is measured per calendar month in Swedish time (see CONTEXT.md, "Spend period"). */
const TIME_ZONE = 'Europe/Stockholm';

export interface SpendPeriod {
  /** First day, inclusive (YYYY-MM-DD). */
  start: string;
  /** Last day, inclusive (YYYY-MM-DD). */
  end: string;
  /** Instant the period starts, inclusive. */
  startsAt: Date;
  /** Instant the next period starts, exclusive. */
  endsAt: Date;
}

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric',
});

/** Wall-clock fields of an instant in Stockholm. */
function wallClock(instant: Date) {
  const f = Object.fromEntries(parts.formatToParts(instant).map((p) => [p.type, Number(p.value)]));
  return { year: f.year!, month: f.month!, day: f.day!, hour: f.hour!, minute: f.minute!, second: f.second! };
}

/** The UTC instant of midnight on a Stockholm calendar date. */
function stockholmMidnight(year: number, month: number, day: number): Date {
  const asUtc = Date.UTC(year, month - 1, day);
  const w = wallClock(new Date(asUtc));
  // Offset of Stockholm from UTC at that moment (+1h winter, +2h summer).
  const offset = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - asUtc;
  return new Date(asUtc - offset);
}

const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function spendPeriodFor(now: Date): SpendPeriod {
  const { year, month } = wallClock(now);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: isoDate(year, month, 1),
    end: isoDate(year, month, lastDay),
    startsAt: stockholmMidnight(year, month, 1),
    endsAt: stockholmMidnight(nextYear, nextMonth, 1),
  };
}

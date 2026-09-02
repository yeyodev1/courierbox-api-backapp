/**
 * Some fields are a day, not an instant: the date an expense was incurred, the
 * date on an invoice, a tentative delivery date. The UI sends them as `YYYY-MM-DD`,
 * which `new Date()` reads as UTC midnight — so every reader that renders them in
 * UTC agrees on the day the operator typed.
 *
 * The default used to be `new Date()`, a real instant. Filed at 20:00 in Ecuador
 * (UTC-5) that lands on the *next* UTC day, so an expense entered on the evening of
 * the 28th was stored as the 29th. Anchoring the default to Ecuador's current day,
 * at UTC midnight, gives stored and typed dates the same shape whichever path
 * created them.
 */

/** Courier Box operates in Ecuador, which has no daylight saving. */
const ECUADOR_OFFSET_MINUTES = 5 * 60;

/** UTC midnight of the day the given instant falls on, in UTC. */
function startOfUtcDay(instant: Date): Date {
  return new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate())
  );
}

/** UTC midnight of the day it currently is in Ecuador — the operator's "today". */
export function todayAsCalendarDate(now: Date = new Date()): Date {
  return startOfUtcDay(new Date(now.getTime() - ECUADOR_OFFSET_MINUTES * 60_000));
}

/**
 * Normalises an accepted date input to UTC midnight of the day it names.
 * Returns `undefined` for an absent or unparseable value, so an optional field
 * stays absent rather than silently becoming today.
 */
export function toCalendarDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === "") return undefined;

  const parsed = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(parsed.getTime())) return undefined;

  return startOfUtcDay(parsed);
}

/**
 * The last instant of the day a value names, for an inclusive `$lte` range.
 * The old code built this with `setHours(23, 59, 59, 999)`, which reads local
 * hours off a UTC-midnight date and so stretched the range five hours into the
 * next day; the summary endpoint skipped the end-of-day step altogether, so a
 * filter's last day showed in the list but not in the totals.
 */
export function endOfCalendarDate(value: unknown): Date | undefined {
  const day = toCalendarDate(value);
  if (!day) return undefined;
  return new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1);
}

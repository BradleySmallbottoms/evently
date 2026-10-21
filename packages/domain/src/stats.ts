/** Lifetime + calendar bucket keys for a base stat name. */

export type StatsSourceType = 'user' | 'event' | 'publisher';

export type StatMutation =
  | { key: string; add: number; remove?: undefined; value?: undefined }
  | { key: string; remove: number; add?: undefined; value?: undefined }
  | { key: string; value: number; add?: undefined; remove?: undefined };

export type StatMutationInput = {
  key: string;
  add?: number;
  remove?: number;
  value?: number;
};

export function parseStatMutation(input: StatMutationInput): StatMutation | { error: string } {
  const modes = [
    input.add !== undefined,
    input.remove !== undefined,
    input.value !== undefined,
  ].filter(Boolean).length;
  if (modes !== 1) {
    return { error: 'Exactly one of add, remove, or value is required' };
  }
  if (input.add !== undefined) return { key: input.key, add: input.add };
  if (input.remove !== undefined) return { key: input.key, remove: input.remove };
  return { key: input.key, value: input.value! };
}

/** Apply one mutation. Missing row treated as 0. remove does not clamp. */
export function applyStatMutation(current: number | null | undefined, op: StatMutation): number {
  const base = current ?? 0;
  if ('add' in op && op.add !== undefined) return base + op.add;
  if ('remove' in op && op.remove !== undefined) return base - op.remove;
  return op.value;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Parts in `timeZone` (launch default Europe/Stockholm). */
export function calendarParts(
  at: Date,
  timeZone = 'Europe/Stockholm',
): { year: number; month: number; day: number; isoWeek: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(at)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  ) as { year: string; month: string; day: string };
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  // ISO week from the local y-m-d interpreted as UTC noon to avoid DST edges.
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const isoWeek = isoWeekNumber(utcNoon);
  return { year, month, day, isoWeek };
}

/** ISO-8601 week number (1–53). */
export function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * Lifetime + day + week + month + year keys for a base counter.
 * - day: `{base}-YYYY-MM-DD`
 * - week: `{base}-wWW`
 * - month: `{base}-YYYY-mMM`
 * - year: `{base}-YYYY`
 */
export function bucketKeys(baseKey: string, at: Date, timeZone = 'Europe/Stockholm'): string[] {
  const { year, month, day, isoWeek } = calendarParts(at, timeZone);
  return [
    baseKey,
    `${baseKey}-${year}-${pad2(month)}-${pad2(day)}`,
    `${baseKey}-w${pad2(isoWeek)}`,
    `${baseKey}-${year}-m${pad2(month)}`,
    `${baseKey}-${year}`,
  ];
}

/** Expand a base key into add/remove/value ops across all calendar buckets. */
export function bucketMutations(
  baseKey: string,
  amount: number,
  mode: 'add' | 'remove' | 'value',
  at: Date,
  timeZone = 'Europe/Stockholm',
): StatMutation[] {
  return bucketKeys(baseKey, at, timeZone).map((key) => {
    if (mode === 'add') return { key, add: amount };
    if (mode === 'remove') return { key, remove: amount };
    return { key, value: amount };
  });
}

export function ratingAverage(numRatings: number, totalRatingValue: number): number | null {
  if (numRatings <= 0) return null;
  return roundRatingAverage(totalRatingValue / numRatings);
}

export function roundRatingAverage(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(value * 10) / 10;
}

export function averageFromScores(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return roundRatingAverage(sum / scores.length);
}

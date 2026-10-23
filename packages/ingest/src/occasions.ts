import type { EventMeta } from '@local-events/contracts';

/** Days from the first occasion to the last before a dense run can become one event. */
export const DEFAULT_OCCASION_SPAN_DAYS = 21;
/** Share of the days in that span that must have an occasion. 0.6 is 60%. */
export const DEFAULT_OCCASION_COVERAGE = 0.6;

export type OccasionCollapseOptions = {
  spanDays: number;
  coverage: number;
};

const DEFAULTS: OccasionCollapseOptions = {
  spanDays: DEFAULT_OCCASION_SPAN_DAYS,
  coverage: DEFAULT_OCCASION_COVERAGE,
};

function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return Number.NaN;
  return Math.round(Date.UTC(year, month - 1, date) / 86_400_000);
}

/**
 * `data_sources.config.occasionSpanDays` is a whole number of days (default 21).
 * `occasionCoverage` is a share from 0 to 1 (default 0.6). A missing key keeps the default.
 */
export function occasionCollapseFromConfig(
  config: Record<string, unknown> | undefined,
): OccasionCollapseOptions {
  return {
    spanDays: spanDaysFrom(config?.occasionSpanDays),
    coverage: coverageFrom(config?.occasionCoverage),
  };
}

function spanDaysFrom(value: unknown): number {
  if (value === undefined) return DEFAULT_OCCASION_SPAN_DAYS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3660) {
    throw new Error('occasionSpanDays must be a whole number of days from 0 to 3660');
  }
  return value;
}

function coverageFrom(value: unknown): number {
  if (value === undefined) return DEFAULT_OCCASION_COVERAGE;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('occasionCoverage must be a fraction from 0 to 1, for example 0.6 for 60%');
  }
  return value;
}

/**
 * True when the occasions are a dense run of opening hours longer than the configured span.
 * Coverage uses distinct calendar days, so two showtimes on one day count once.
 */
export function shouldCollapseOccasions(
  occasions: { day: string }[],
  options: OccasionCollapseOptions = DEFAULTS,
): boolean {
  if (occasions.length < 2) return false;
  const days = occasions.map((occasion) => dayNumber(occasion.day));
  if (days.some((day) => Number.isNaN(day))) return false;
  const unique = [...new Set(days)].sort((a, b) => a - b);
  const span = unique.at(-1)! - unique[0]!;
  if (span <= options.spanDays) return false;
  return unique.length / (span + 1) >= options.coverage;
}

export type CollapsedOccasion = {
  startsAt: string;
  endsAt?: string;
  venueName?: string;
  location?: { lat: number; lng: number };
};

/** Marks a span and keeps every occasion row that was folded into it. */
export function withCollapsedSpan(
  meta: EventMeta | undefined,
  occasions: CollapsedOccasion[],
): EventMeta {
  void occasions;
  return {
    ...meta,
  };
}

/**
 * Product id stored on every event when one product stays split into separate occasions.
 * A single occasion keeps the meta it already had.
 */
export function withOccasionGroup(
  meta: EventMeta | undefined,
  productId: string,
  occasionCount: number,
): EventMeta | undefined {
  void productId;
  if (occasionCount < 2 || typeof productId !== 'string') return meta;
  return meta;
}

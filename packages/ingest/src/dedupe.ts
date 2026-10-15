import {
  DUPLICATE_MIN_TITLE_SIMILARITY,
  DUPLICATE_RADIUS_M,
  DUPLICATE_WINDOW_MINUTES,
} from '@local-events/domain';
import { distanceMeters, type GeoPoint } from '@local-events/geo';

function trigrams(text: string): Set<string> {
  const s = `  ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Trigram Jaccard similarity, mirroring Postgres pg_trgm closely enough for pre-checks. */
export function titleSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface DedupeCandidate {
  title: string;
  startsAt: Date;
  location?: GeoPoint;
}

/**
 * Title check for the shared duplicate rule: start within 30 minutes, within 200 m.
 * An event without a point is not compared. Id and link matches live in
 * `duplicateIdsMatch` and `duplicateLinksMatch`.
 */
export function isLikelySameEvent(a: DedupeCandidate, b: DedupeCandidate): boolean {
  const minutes = Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) / 60_000;
  if (minutes > DUPLICATE_WINDOW_MINUTES) return false;
  if (!a.location || !b.location) return false;
  if (distanceMeters(a.location, b.location) > DUPLICATE_RADIUS_M) return false;
  return titleSimilarity(a.title, b.title) >= DUPLICATE_MIN_TITLE_SIMILARITY;
}

import { distanceMeters, type GeoPoint } from '@local-events/geo';

export const DEDUPE = {
  maxStartDifferenceMinutes: 30,
  maxDistanceM: 200,
  minTitleSimilarity: 0.5,
} as const;

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

/** Cross-source match: start time, distance and title similarity must all agree. */
export function isLikelySameEvent(a: DedupeCandidate, b: DedupeCandidate): boolean {
  const minutes = Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) / 60_000;
  if (minutes > DEDUPE.maxStartDifferenceMinutes) return false;
  if (a.location && b.location && distanceMeters(a.location, b.location) > DEDUPE.maxDistanceM) {
    return false;
  }
  return titleSimilarity(a.title, b.title) >= DEDUPE.minTitleSimilarity;
}

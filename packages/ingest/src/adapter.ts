import type { IncomingEvent } from './incoming-event';

export type SourceKind = 'api' | 'feed' | 'scraper';

export interface SourceRunContext {
  sourceSlug: string;
  /** Per-source config from the data_sources row (URLs, ids). Secrets come from AWS, not here. */
  config: Record<string, unknown>;
  /** Fetch with the crawler's User-Agent, rate limits and timeouts applied. */
  fetch: typeof fetch;
  log: (message: string, data?: Record<string, unknown>) => void;
}

/**
 * A source adapter only fetches and maps. Validation, geocoding, publisher resolution,
 * dedupe and the upsert are done by the ingest pipeline, never by an adapter.
 */
export interface SourceAdapter<Raw = unknown> {
  slug: string;
  kind: SourceKind;
  fetchRaw(ctx: SourceRunContext): Promise<Raw>;
  map(raw: Raw, ctx: SourceRunContext): IncomingEvent[] | Promise<IncomingEvent[]>;
  /** Tag vocabulary from this payload. Persisted before events are tagged. */
  tags?(raw: Raw, ctx: SourceRunContext): { externalId: string; name: string }[];
}

export function defineAdapter<Raw>(adapter: SourceAdapter<Raw>): SourceAdapter<Raw> {
  return adapter;
}

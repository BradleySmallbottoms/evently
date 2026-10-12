import { contentHash, IncomingEvent, type SourceRunContext } from '@local-events/ingest';
import { sources } from './sources';

export interface RunSummary {
  source: string;
  fetched: number;
  valid: number;
  invalid: { externalId: string | undefined; issues: string }[];
  hashes: string[];
  events: IncomingEvent[];
  /** Tag vocabulary from the source, upserted before events are linked. */
  tags: { externalId: string; name: string }[];
  /** Unmapped adapter payload — stored to S3 as `raw/<slug>/<runId>`. */
  raw: unknown;
}

/** Fetch, map and validate one source. Persistence is `persistSource`. */
export async function runSource(
  slug: string,
  config: Record<string, unknown> = {},
): Promise<RunSummary> {
  const adapter = sources[slug];
  if (!adapter)
    throw new Error(`Unknown source "${slug}". Known: ${Object.keys(sources).join(', ')}`);

  const ctx: SourceRunContext = {
    sourceSlug: slug,
    config,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          'user-agent': 'LocalEventsBot/0.1 (+contact: set-me@example.com)',
          ...init?.headers,
        },
        signal: AbortSignal.timeout(30_000),
      }),
    log: (message, data) => console.log(JSON.stringify({ source: slug, message, ...data })),
  };

  const raw = await adapter.fetchRaw(ctx);
  const mapped = await adapter.map(raw, ctx);
  const summary: RunSummary = {
    source: slug,
    fetched: mapped.length,
    valid: 0,
    invalid: [],
    hashes: [],
    events: [],
    tags: adapter.tags?.(raw, ctx) ?? [],
    raw,
  };

  for (const item of mapped) {
    const parsed = IncomingEvent.safeParse(item);
    if (parsed.success) {
      summary.valid++;
      summary.hashes.push(contentHash(parsed.data));
      summary.events.push(parsed.data);
    } else {
      summary.invalid.push({ externalId: item.externalId, issues: parsed.error.message });
    }
  }
  return summary;
}

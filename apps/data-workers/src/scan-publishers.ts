import { organizerKeys } from '@local-events/domain';
import type { PromptRunner } from './prompt-runners';
import type { IngestStore, PendingPublisherRow } from './store';

export const PUBLISHER_SCAN_BATCH_LIMIT = 5;
/** Long enough for one web lookup per publisher in the batch. */
export const PUBLISHER_SCAN_LEASE_MS = 10 * 60 * 1000;

export interface PublisherScanSummary {
  claimed: number;
  reviewed: number;
  unavailable: number;
  skipped: number;
  publisherIds: string[];
  /** Set when web search is not configured, so nothing is claimed. */
  reason?: 'no_brave_api_key';
}

export function publisherScanCanRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.BRAVE_API_KEY?.trim());
}

/**
 * Claims `pending_scan` publishers and runs the web lookup.
 * A finished chat moves the publisher to `in_review`. A failure releases the claim.
 */
export async function scanPendingPublishers(
  store: IngestStore,
  runner: PromptRunner,
  options: {
    publisherId?: string;
    limit?: number;
    leaseMs?: number;
    env?: NodeJS.ProcessEnv;
    skipPublisherIds?: readonly string[];
  } = {},
): Promise<PublisherScanSummary> {
  const summary: PublisherScanSummary = {
    claimed: 0,
    reviewed: 0,
    unavailable: 0,
    skipped: 0,
    publisherIds: [],
  };
  if (!publisherScanCanRun(options.env)) {
    summary.reason = 'no_brave_api_key';
    return summary;
  }
  const limit = options.limit ?? PUBLISHER_SCAN_BATCH_LIMIT;
  const leaseMs = options.leaseMs ?? PUBLISHER_SCAN_LEASE_MS;
  const rows = await store.claimPendingPublisherScans(
    limit,
    leaseMs,
    options.publisherId,
    options.skipPublisherIds,
  );
  summary.claimed = rows.length;
  for (const row of rows) {
    summary.publisherIds.push(row.publisherId);
    const outcome = await lookupOne(runner, row);
    if (!outcome.ok) {
      await store.releasePublisherScanClaim(row.publisherId, row.claimedUntil);
      summary.unavailable += 1;
      continue;
    }
    if (outcome.profile?.website && row.sourceId && row.sourceSlug) {
      const keys = organizerKeys({
        infoUrls: [outcome.profile.website],
        fallback: row.sourceSlug,
      }).filter((key) => key !== row.sourceSlug);
      if (keys.length > 0) await store.rememberOrganizerKeys(row.sourceId, row.publisherId, keys);
    }
    const saved = await store.finishPublisherScan({
      publisherId: row.publisherId,
      claimedUntil: row.claimedUntil,
      lookup: outcome.profile,
    });
    if (!saved) summary.skipped += 1;
    else summary.reviewed += 1;
  }
  return summary;
}

async function lookupOne(
  runner: PromptRunner,
  row: PendingPublisherRow,
): Promise<Awaited<ReturnType<PromptRunner['lookupPublisher']>>> {
  try {
    return await runner.lookupPublisher({
      publisherId: row.publisherId,
      name: row.name,
      organizerKeys: row.organizerKeys,
      title: row.title ?? row.name,
      ...(row.sourceUrl ? { publisherUrl: row.sourceUrl } : {}),
      ...(row.description ? { description: row.description } : {}),
      ...(row.venueName ? { venue: row.venueName } : {}),
      ...(row.location ? { location: row.location } : {}),
    });
  } catch (error) {
    console.error(
      'publisher lookup failed',
      row.publisherId,
      error instanceof Error ? error.message : error,
    );
    return { ok: false, reason: 'unavailable' };
  }
}

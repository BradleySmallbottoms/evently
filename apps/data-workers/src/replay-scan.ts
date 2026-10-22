import { type DomainEvent } from '@local-events/contracts';
import { emitDomainEvent, noopDomainEvents, type DomainEventSink } from './domain-events';
import { parseStoredScanOutput, scanOutcomeFromContent } from './prompt-runners';
import { applyOutcome, scanInputFor } from './scan-pending';
import type { IngestStore, PublisherLink } from './store';

const REPLAY_BATCH_LIMIT = 50;

export interface ReplayScanSummary {
  claimed: number;
  published: number;
  review: number;
  unavailable: number;
  skipped: number;
  eventIds: string[];
  dryRun: boolean;
}

export async function replayStoredScans(
  store: IngestStore,
  enqueue: DomainEventSink = noopDomainEvents,
  options: {
    eventId?: string;
    limit?: number;
    batchLimit?: number;
    fetch?: typeof fetch;
    dryRun?: boolean;
  } = {},
): Promise<ReplayScanSummary> {
  const catalog = (await store.listTags()).map((tag) => ({
    externalId: tag.externalId,
    name: tag.name,
  }));
  const fetchImpl = options.fetch ?? fetch;
  const batchLimit = Math.max(1, options.batchLimit ?? REPLAY_BATCH_LIMIT);
  const maxRows = options.limit ?? Number.POSITIVE_INFINITY;
  const temporaries = new Map<string, PublisherLink>();
  const seen = new Set<string>();
  const summary: ReplayScanSummary = {
    claimed: 0,
    published: 0,
    review: 0,
    unavailable: 0,
    skipped: 0,
    eventIds: [],
    dryRun: options.dryRun === true,
  };

  while (summary.claimed < maxRows) {
    const remaining = Number.isFinite(maxRows)
      ? Math.max(0, maxRows - summary.claimed)
      : batchLimit;
    const take = Math.max(1, Math.min(batchLimit, remaining));
    const rows = await store.listStoredScans(take, options.eventId, [...seen]);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (summary.claimed >= maxRows) break;
      seen.add(row.eventId);
      summary.claimed += 1;
      summary.eventIds.push(row.eventId);
      const parsed = parseStoredScanOutput(row.llmOutput);
      if (!parsed) {
        summary.skipped += 1;
        continue;
      }
      try {
        const input = scanInputFor(row);
        const outcome = await scanOutcomeFromContent(input, parsed, { store, catalog });
        if (options.dryRun) {
          const wouldPublish =
            outcome.approved &&
            outcome.publisher.kind === 'existing' &&
            !outcome.publisher.isTemporary &&
            outcome.publisher.status === 'published' &&
            row.sourceTrust === 'auto_publish' &&
            outcome.duplicate === null;
          if (wouldPublish) summary.published += 1;
          else summary.review += 1;
          continue;
        }
        const applied = await applyOutcome(
          store,
          row,
          outcome,
          enqueue,
          temporaries,
          fetchImpl,
          async ({ claimedUntil, ...write }) => {
            void claimedUntil;
            return store.reapplyImportedScan(write);
          },
        );
        if (applied === 'published') {
          summary.published += 1;
          if (row.status !== 'published') {
            await notifyTipScan(store, enqueue, row.eventId, 'published');
          }
        } else if (applied === 'review') {
          summary.review += 1;
          if (row.status !== 'in_review') {
            await notifyTipScan(store, enqueue, row.eventId, 'in_review');
          }
        } else {
          summary.skipped += 1;
        }
      } catch (error) {
        console.error(
          'replay scan apply failed',
          row.eventId,
          error instanceof Error ? error.message : error,
        );
        summary.unavailable += 1;
      }
    }
    if (options.eventId) break;
  }
  return summary;
}

async function notifyTipScan(
  store: IngestStore,
  enqueue: DomainEventSink,
  eventId: string,
  status: 'published' | 'in_review' | 'failed',
): Promise<void> {
  const marked = await store.markTipScanned({ eventId, status, now: new Date() });
  if (!marked) return;
  await emitDomainEvent(enqueue, {
    type: 'tip.scanned',
    tipId: marked.tipId,
    eventId,
    status,
  } satisfies DomainEvent);
}

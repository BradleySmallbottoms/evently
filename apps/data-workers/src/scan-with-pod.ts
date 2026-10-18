import { tryHoldAdvisoryLock } from '@local-events/db';
import { createOllamaWithToolsPromptRunner } from './prompt-runners/chatwithtools';
import {
  createRunpodChat,
  runpodChatConfigFromEnv,
  type RunpodChat,
} from './runpod-chat';
import {
  SCAN_BATCH_LIMIT,
  scanPendingEvents,
  type ScanSummary,
} from './scan-pending';
import { noopDomainEvents, type DomainEventSink } from './domain-events';
import type { IngestStore } from './store';

/** Long enough for one parallel batch of slow remote rounds. */
export const POD_SCAN_LEASE_MS = 30 * 60 * 1000;

export interface PodScanSummary extends ScanSummary {
  /** `busy` means another scan still holds the lock. `idle` means the queue was empty. */
  pod: 'busy' | 'idle' | 'ran';
}

export async function scanWithChatPod(input: {
  store: IngestStore;
  databaseUrl: string;
  enqueue?: DomainEventSink;
  selection?: { eventId?: string; limit?: number };
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  holdLock?: typeof tryHoldAdvisoryLock;
  chat?: RunpodChat;
}): Promise<PodScanSummary> {
  const env = input.env ?? process.env;
  let chat = input.chat;
  if (!chat) {
    const config = runpodChatConfigFromEnv(env);
    if ('error' in config) throw new Error(config.error);
    chat = createRunpodChat(config, {
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...(input.sleep ? { sleep: input.sleep } : {}),
      ...(input.now ? { now: input.now } : {}),
    });
  }
  const holdLock = input.holdLock ?? tryHoldAdvisoryLock;
  const hold = await holdLock(input.databaseUrl);
  if (!hold) return { ...emptySummary(), pod: 'busy' };

  let summary: PodScanSummary | undefined;
  let failure: unknown;
  try {
    const pending = await input.store.countPendingScans(input.selection?.eventId);
    if (pending === 0) {
      await chat.stopIfRunning();
      summary = { ...emptySummary(), pod: 'idle' };
    } else {
      const ready = await chat.ensureReady();
      const runner = createOllamaWithToolsPromptRunner(input.store, {
        concurrency: ready.concurrency,
        ...(input.fetch ? { fetch: input.fetch } : {}),
        config: {
          chatProvider: 'openai',
          chatUrl: ready.chatUrl,
          chatModel: ready.model,
          chatAuth: ready.auth,
        },
      });
      const drained = await drainScans(input.store, runner, input.enqueue ?? noopDomainEvents, input.selection);
      summary = { ...drained, pod: 'ran' };
    }
  } catch (err) {
    failure = err;
  } finally {
    try {
      await chat.stop();
    } catch (err) {
      console.error(err);
      failure ??= err;
    }
    await hold.release();
  }
  if (failure) throw failure;
  return summary ?? { ...emptySummary(), pod: 'ran' };
}

async function drainScans(
  store: IngestStore,
  runner: Parameters<typeof scanPendingEvents>[1],
  enqueue: DomainEventSink,
  selection: { eventId?: string; limit?: number } = {},
): Promise<ScanSummary> {
  const totals = emptySummary();
  const skip = new Set<string>();
  const oneBatch = selection.eventId != null || selection.limit != null;
  for (;;) {
    const summary = await scanPendingEvents(store, runner, enqueue, {
      leaseMs: POD_SCAN_LEASE_MS,
      limit: selection.limit ?? SCAN_BATCH_LIMIT,
      ...(selection.eventId ? { eventId: selection.eventId } : {}),
      skipEventIds: [...skip],
    });
    totals.claimed += summary.claimed;
    totals.published += summary.published;
    totals.review += summary.review;
    totals.unavailable += summary.unavailable;
    totals.skipped += summary.skipped;
    totals.eventIds.push(...summary.eventIds);
    for (const id of summary.eventIds) skip.add(id);
    if (summary.claimed === 0 || oneBatch) return totals;
  }
}

function emptySummary(): ScanSummary {
  return { claimed: 0, published: 0, review: 0, unavailable: 0, skipped: 0, eventIds: [] };
}

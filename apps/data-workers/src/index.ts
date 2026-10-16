import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { createDbIngestStore } from './db-store';
import { createSqsDomainEventPublisher, noopDomainEvents } from './domain-events';
import { eventImageUploaderFromEnv } from './event-images';
import { persistSource } from './persist';
import { promptRunnerFromEnv } from './prompt-runners';
import { scanPendingEvents } from './scan-pending';
import { rawPayloadSinkFromEnv } from './raw-payload';
import { runSource } from './run';
import { initSentry, Sentry } from './sentry';

initSentry('data-workers');

/**
 * Container entrypoint. EventBridge Scheduler starts one Fargate task per source with
 * SOURCE_SLUG set (or pass --source <slug> locally).
 *   pnpm --filter @local-events/data-workers dev -- --source visit-soderhamn
 *
 * The import scan job claims `pending_scan` events and runs the prompt runner.
 *   pnpm --filter @local-events/data-workers dev -- --job event-scan
 *
 * A source with a data_sources row is fetched and saved. A slug with no row (the example
 * fixture) is validated only.
 */
function argValue(flag: string, envName: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : process.env[envName];
}

const job = argValue('--job', 'JOB');
const slug = argValue('--source', 'SOURCE_SLUG');
if (job !== 'event-scan' && !slug) {
  console.error('Missing source: pass --source <slug> or set SOURCE_SLUG');
  process.exit(2);
}

async function main(): Promise<number> {
  if (job === 'event-scan') {
    const databaseUrl = resolveDatabaseUrl();
    if (!databaseUrl) {
      console.error('DATABASE_URL is required for --job event-scan');
      return 1;
    }
    const db = createDb(databaseUrl);
    const store = createDbIngestStore(db);
    const queueUrl = process.env.DOMAIN_EVENTS_QUEUE_URL?.trim();
    const enqueue = queueUrl ? createSqsDomainEventPublisher({ queueUrl }) : noopDomainEvents;
    const summary = await scanPendingEvents(store, promptRunnerFromEnv(store), enqueue);
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    const summary = await runSource(slug!);
    console.log(JSON.stringify(summary, null, 2));
    return summary.invalid.length > 0 ? 1 : 0;
  }

  const db = createDb(databaseUrl);
  const store = createDbIngestStore(db);
  const source = await store.getSource(slug!);
  if (!source) {
    const summary = await runSource(slug!);
    console.log(JSON.stringify({ ...summary, saved: false }, null, 2));
    return summary.invalid.length > 0 ? 1 : 0;
  }

  const queueUrl = process.env.DOMAIN_EVENTS_QUEUE_URL?.trim();
  const enqueue = queueUrl ? createSqsDomainEventPublisher({ queueUrl }) : noopDomainEvents;
  const rawSink = rawPayloadSinkFromEnv();
  if (!source.enabled) {
    console.log(
      JSON.stringify({
        source: slug,
        message: 'source is disabled; this manual run still saves',
      }),
    );
  }
  const summary = await persistSource(store, slug!, enqueue, rawSink, eventImageUploaderFromEnv());
  console.log(JSON.stringify(summary, null, 2));
  return summary.invalid.length > 0 || summary.rejected.length > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    Sentry.captureException(err);
    console.error(err);
    process.exit(1);
  });

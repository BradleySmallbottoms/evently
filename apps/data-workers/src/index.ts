import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { createDbIngestStore } from './db-store';
import { createSqsDomainEventPublisher, noopDomainEvents } from './domain-events';
import { eventImageUploaderFromEnv } from './event-images';
import { persistSource } from './persist';
import { rawPayloadSinkFromEnv } from './raw-payload';
import { runSource } from './run';
import { initSentry, Sentry } from './sentry';

initSentry('data-workers');

/**
 * Container entrypoint. EventBridge Scheduler starts one Fargate task per source with
 * SOURCE_SLUG set (or pass --source <slug> locally).
 *   pnpm --filter @local-events/data-workers dev -- --source visit-soderhamn
 *
 * A source with a data_sources row is fetched and saved. A slug with no row (the example
 * fixture) is validated only.
 */
function sourceFromArgs(): string | undefined {
  const i = process.argv.indexOf('--source');
  return i >= 0 ? process.argv[i + 1] : process.env.SOURCE_SLUG;
}

const slug = sourceFromArgs();
if (!slug) {
  console.error('Missing source: pass --source <slug> or set SOURCE_SLUG');
  process.exit(2);
}

async function main(): Promise<number> {
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

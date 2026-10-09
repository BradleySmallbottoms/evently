import { processMessage } from './handlers';
import { initSentry, Sentry } from './sentry';

initSentry('worker');

/**
 * SQS long-poll loop. The AWS SDK client is wired in Phase 3; until then this file documents
 * the shape: receive → processMessage → delete on success, leave for retry/DLQ on failure.
 */
async function main() {
  console.log('worker started (SQS consumer not wired yet)');
  void processMessage;
}

main().catch((err) => {
  Sentry.captureException(err);
  console.error(err);
  process.exit(1);
});

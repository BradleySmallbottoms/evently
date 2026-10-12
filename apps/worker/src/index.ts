import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { processMessage, type HandlerContext } from './handlers';
import { handleDuePushMessages } from './notify/handle-due-push';
import { createExpoPushClient } from './notify/expo-push';
import { initSentry, Sentry } from './sentry';
import { createHttpStatsWriter } from './stats/apply';
import { reconcileAllStats } from './stats/recompute';

initSentry('worker');

const queueUrl = process.env.DOMAIN_EVENTS_QUEUE_URL?.trim();
const region = process.env.AWS_REGION ?? 'eu-north-1';
const waitTimeSeconds = Number(process.env.SQS_WAIT_TIME_SECONDS ?? 20);
const maxMessages = Number(process.env.SQS_MAX_MESSAGES ?? 10);
/** Default 24h; set 0 to disable nightly stats reconciliation. */
const statsReconcileMs = Number(process.env.STATS_RECONCILE_MS ?? 86_400_000);
/** Poll approved push_messages for due delivery. */
const pushPollMs = Number(process.env.PUSH_POLL_MS ?? 30_000);
const databaseUrl = resolveDatabaseUrl();
/** Public API base including version prefix, e.g. http://localhost:3000/v1 */
const statsApiUrl = process.env.STATS_API_URL?.trim() || process.env.API_URL?.trim();
const statsWorkerToken = process.env.STATS_WORKER_TOKEN?.trim();
const sqsEndpoint =
  process.env.AWS_ENDPOINT_URL_SQS?.trim() || process.env.AWS_ENDPOINT_URL?.trim() || undefined;

function createSqsClient(): SQSClient {
  return new SQSClient({
    region,
    ...(sqsEndpoint
      ? {
          endpoint: sqsEndpoint,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
          },
        }
      : {}),
  });
}

function buildHandlerContext(): HandlerContext {
  if (!databaseUrl) return {};
  if (!statsApiUrl || !statsWorkerToken) {
    throw new Error(
      'STATS_API_URL (or API_URL) and STATS_WORKER_TOKEN are required; worker must PUT stats via the API',
    );
  }
  const db = createDb(databaseUrl);
  return {
    db,
    stats: createHttpStatsWriter(statsApiUrl, statsWorkerToken),
    notify: {
      db,
      expo: createExpoPushClient(),
    },
  };
}

async function pollOnce(client: SQSClient, ctx: HandlerContext): Promise<void> {
  const res = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: waitTimeSeconds,
      VisibilityTimeout: 60,
    }),
  );
  for (const message of res.Messages ?? []) {
    if (!message.Body || !message.ReceiptHandle) continue;
    try {
      const type = await processMessage(message.Body, ctx);
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
      console.log(JSON.stringify({ deleted: type, messageId: message.MessageId }));
    } catch (err) {
      Sentry.captureException(err);
      console.error('handler failed; message left for retry/DLQ', err);
    }
  }
}

async function main() {
  if (!queueUrl) {
    console.log('worker idle: DOMAIN_EVENTS_QUEUE_URL not set');
    await new Promise(() => {
      /* never resolves */
    });
    return;
  }

  if (!databaseUrl) {
    console.warn('DATABASE_URL not set; worker will acknowledge events without sending push');
  }

  const ctx = buildHandlerContext();
  const client = createSqsClient();
  console.log(
    JSON.stringify({
      worker: 'started',
      region,
      endpoint: sqsEndpoint ?? 'aws',
      notify: Boolean(ctx.notify),
      stats: Boolean(ctx.stats),
      statsReconcileMs,
      queueConfigured: true,
    }),
  );

  if (ctx.db && ctx.stats && statsReconcileMs > 0) {
    const db = ctx.db;
    const stats = ctx.stats;
    const runReconcile = async () => {
      try {
        const result = await reconcileAllStats(db, stats);
        console.log(JSON.stringify({ statsReconcile: result }));
      } catch (err) {
        Sentry.captureException(err);
        console.error('stats reconcile failed', err);
      }
    };
    void runReconcile();
    setInterval(() => void runReconcile(), statsReconcileMs);
  }

  if (ctx.notify && pushPollMs > 0) {
    const notify = ctx.notify;
    const runDuePush = async () => {
      try {
        const result = await handleDuePushMessages(notify);
        if (result.claimed > 0 || result.orphans > 0) {
          console.log(JSON.stringify({ duePush: result }));
        }
      } catch (err) {
        Sentry.captureException(err);
        console.error('due push poll failed', err);
      }
    };
    void runDuePush();
    setInterval(() => void runDuePush(), pushPollMs);
  }

  for (;;) {
    try {
      await pollOnce(client, ctx);
    } catch (err) {
      Sentry.captureException(err);
      console.error('poll failed', err);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

main().catch((err) => {
  Sentry.captureException(err);
  console.error(err);
  process.exit(1);
});

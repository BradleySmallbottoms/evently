import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { processMessage } from './handlers';
import { initSentry, Sentry } from './sentry';

initSentry('worker');

const queueUrl = process.env.DOMAIN_EVENTS_QUEUE_URL?.trim();
const region = process.env.AWS_REGION ?? 'eu-north-1';
const waitTimeSeconds = Number(process.env.SQS_WAIT_TIME_SECONDS ?? 20);
const maxMessages = Number(process.env.SQS_MAX_MESSAGES ?? 10);

async function pollOnce(client: SQSClient): Promise<void> {
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
      const type = await processMessage(message.Body);
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
    // Keep process alive in ECS/dev so the service does not crash-loop.
    await new Promise(() => {
      /* never resolves */
    });
    return;
  }

  const client = new SQSClient({ region });
  console.log(JSON.stringify({ worker: 'started', queueUrl, region }));
  for (;;) {
    try {
      await pollOnce(client);
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

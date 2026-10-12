import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { DomainEvent } from '@local-events/contracts';

export interface DomainEventSink {
  publish(event: DomainEvent): Promise<void>;
}

export const noopDomainEvents: DomainEventSink = {
  async publish() {},
};

/** Best-effort. A queue failure must not roll back an event that is already stored. */
export async function emitDomainEvent(sink: DomainEventSink, event: DomainEvent): Promise<void> {
  try {
    await sink.publish(event);
  } catch (err) {
    console.error('domain event enqueue failed', { type: event.type, err });
  }
}

export function createSqsDomainEventPublisher(input: {
  queueUrl: string;
  region?: string;
}): DomainEventSink {
  const endpoint =
    process.env.AWS_ENDPOINT_URL_SQS?.trim() || process.env.AWS_ENDPOINT_URL?.trim() || undefined;
  const client = new SQSClient({
    region: input.region ?? process.env.AWS_REGION ?? 'eu-north-1',
    ...(endpoint
      ? {
          endpoint,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
          },
        }
      : {}),
  });
  return {
    async publish(event) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: input.queueUrl,
          MessageBody: JSON.stringify(event),
        }),
      );
    },
  };
}

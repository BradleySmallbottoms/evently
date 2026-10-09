import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { DomainEvent } from '@local-events/contracts';
import type { DomainEventPublisher } from './types';

export function createSqsDomainEventPublisher(input: {
  queueUrl: string;
  region?: string;
}): DomainEventPublisher {
  const client = new SQSClient({ region: input.region ?? process.env.AWS_REGION ?? 'eu-north-1' });
  return {
    async publish(event: DomainEvent) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: input.queueUrl,
          MessageBody: JSON.stringify(event),
        }),
      );
    },
  };
}

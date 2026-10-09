import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { DomainEvent } from '@local-events/contracts';
import type { DomainEventPublisher } from './types';

/** SQS client: real AWS in deployed envs; ElasticMQ locally via AWS_ENDPOINT_URL_SQS. */
export function createSqsClient(region?: string): SQSClient {
  const resolvedRegion = region ?? process.env.AWS_REGION ?? 'eu-north-1';
  const endpoint =
    process.env.AWS_ENDPOINT_URL_SQS?.trim() || process.env.AWS_ENDPOINT_URL?.trim() || undefined;
  return new SQSClient({
    region: resolvedRegion,
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
}

export function createSqsDomainEventPublisher(input: {
  queueUrl: string;
  region?: string;
}): DomainEventPublisher {
  const client = createSqsClient(input.region);
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

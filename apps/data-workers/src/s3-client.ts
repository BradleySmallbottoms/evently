import { S3Client } from '@aws-sdk/client-s3';

/**
 * S3 in AWS, or Garage when S3_ENDPOINT is set.
 * The endpoint is only applied to this client, so the SQS client keeps using ElasticMQ.
 */
export function s3ClientFromEnv(env: NodeJS.ProcessEnv = process.env): S3Client {
  const endpoint = env.S3_ENDPOINT?.trim();
  return new S3Client({
    region: env.S3_REGION?.trim() || env.AWS_REGION?.trim() || 'eu-north-1',
    ...(endpoint
      ? {
          endpoint,
          forcePathStyle: true,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
            secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
          },
        }
      : {}),
  });
}

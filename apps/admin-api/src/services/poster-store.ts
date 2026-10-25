import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type PosterStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
};

/** Garage or S3 for the public assets bucket. Undefined when the bucket is unset. */
export function posterStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PosterStore | undefined {
  const bucket = env.PUBLIC_ASSETS_BUCKET?.trim();
  if (!bucket) return undefined;
  const endpoint = env.S3_ENDPOINT?.trim();
  const client = new S3Client({
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
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=86400',
        }),
      );
    },
    async delete(key) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    },
  };
}

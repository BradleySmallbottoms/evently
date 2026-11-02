import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import { s3ClientFromEnv } from './s3-client';

/** Reads one public event image. A missing bucket or object returns null. */
export async function readPublicImage(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
  client?: S3Client,
): Promise<Uint8Array | null> {
  const bucket = env.PUBLIC_ASSETS_BUCKET?.trim();
  if (!bucket || !key) return null;
  const s3 = client ?? s3ClientFromEnv(env);
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = response.Body;
    if (!body) return null;
    return new Uint8Array(await body.transformToByteArray());
  } catch (error) {
    if (missingObject(error)) return null;
    throw error;
  }
}

function missingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('name' in error && (error.name === 'NoSuchKey' || error.name === 'NotFound')) return true;
  if (!('$metadata' in error) || !error.$metadata || typeof error.$metadata !== 'object')
    return false;
  return 'httpStatusCode' in error.$metadata && error.$metadata.httpStatusCode === 404;
}

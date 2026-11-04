import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { imageDeliverySize, safeAssetKey } from '@local-events/domain';
import { IMAGE_SOURCE_MAX_BYTES, renderWebp } from './resize';

const s3 = new S3Client({});

type FunctionUrlEvent = {
  rawPath?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: { http?: { method?: string } };
};

type FunctionUrlResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
};

function text(statusCode: number, message: string): FunctionUrlResult {
  return {
    statusCode,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    body: message,
    isBase64Encoded: false,
  };
}

async function readObject(bucket: string, key: string): Promise<Buffer | null> {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!object.Body || (object.ContentLength ?? 0) > IMAGE_SOURCE_MAX_BYTES) return null;
  const bytes = Buffer.from(await object.Body.transformToByteArray());
  if (bytes.byteLength < 1 || bytes.byteLength > IMAGE_SOURCE_MAX_BYTES) return null;
  return bytes;
}

/** CloudFront origin. Scales a public object to WebP and does not enlarge it. */
export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  const method = event.requestContext?.http?.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') return text(405, 'Method not allowed');
  const bucket = process.env.BUCKET_NAME?.trim();
  const key = safeAssetKey(event.rawPath ?? '');
  if (!bucket || !key) return text(404, 'Not found');

  let original: Buffer | null;
  try {
    original = await readObject(bucket, key);
  } catch {
    return text(404, 'Not found');
  }
  if (!original) return text(404, 'Not found');

  const size = imageDeliverySize({
    w: event.queryStringParameters?.w,
    q: event.queryStringParameters?.q,
  });
  let output = await renderWebp(original, size.width, size.quality);
  if (!output) output = await renderWebp(original, 800, 60);
  if (!output) return text(404, 'Not found');

  return {
    statusCode: 200,
    headers: {
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=86400',
    },
    body: method === 'HEAD' ? '' : output.toString('base64'),
    isBase64Encoded: method !== 'HEAD',
  };
}

import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { s3ClientFromEnv } from './s3-client';

export type RawPayloadSink = {
  save(input: { sourceSlug: string; runId: string; raw: unknown }): Promise<{ key: string } | null>;
};

export const noopRawPayloadSink: RawPayloadSink = {
  async save() {
    return null;
  },
};

/** Serialize adapter raw output for S3. Prefer Buffer/string as-is; JSON for objects. */
export function serializeRawPayload(raw: unknown): { body: Buffer; contentType: string } {
  if (Buffer.isBuffer(raw)) {
    return { body: raw, contentType: 'application/octet-stream' };
  }
  if (typeof raw === 'string') {
    return { body: Buffer.from(raw, 'utf8'), contentType: 'application/json; charset=utf-8' };
  }
  return {
    body: Buffer.from(JSON.stringify(raw), 'utf8'),
    contentType: 'application/json; charset=utf-8',
  };
}

export function rawPayloadKey(sourceSlug: string, runId: string): string {
  return `raw/${sourceSlug}/${runId}`;
}

/**
 * Store one run's raw fetch under `raw/<slug>/<runId>`.
 * Returns null when bucket is unset (local without S3).
 * Upload failures are logged by the caller; this throws so the run can decide.
 */
export function createS3RawPayloadSink(options: {
  bucket: string;
  client?: S3Client;
}): RawPayloadSink {
  const client = options.client ?? s3ClientFromEnv();
  return {
    async save({ sourceSlug, runId, raw }) {
      const key = rawPayloadKey(sourceSlug, runId);
      const { body, contentType } = serializeRawPayload(raw);
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return { key };
    },
  };
}

export function rawPayloadSinkFromEnv(env: NodeJS.ProcessEnv = process.env): RawPayloadSink {
  const bucket = env.RAW_INGESTION_BUCKET?.trim();
  if (!bucket) return noopRawPayloadSink;
  return createS3RawPayloadSink({ bucket });
}

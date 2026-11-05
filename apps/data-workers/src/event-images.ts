import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { s3ClientFromEnv } from './s3-client';

const MAX_BYTES = 8 * 1024 * 1024;

export interface StoredEventImage {
  s3Key: string;
  contentType: string;
}

export interface EventImageUploader {
  put(input: {
    eventId: string;
    sourceUrl: string;
    role?: string;
  }): Promise<StoredEventImage | null>;
}

export const noopEventImageUploader: EventImageUploader = {
  async put() {
    return null;
  },
};

const IMAGE_ROLE = /^(?:main|gallery-(?:[1-9]|1[0-2]))$/;

export function eventImageKey(eventId: string, role = 'main'): string {
  if (!IMAGE_ROLE.test(role)) throw new Error('Invalid event image role');
  return `events/${eventId}/${role}`;
}

/** Dotted IPv4, or the 32 bits embedded in a mapped or compatible IPv6 address. */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number) as [number, number];
  if (a > 255 || b > 255) return false;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** `::ffff:7f00:1` and the older `::7f00:1` both mean 127.0.0.1. */
function embeddedIpv4(host: string): string | undefined {
  const mapped = /^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!mapped?.[1] || !mapped[2]) return undefined;
  const hi = Number.parseInt(mapped[1], 16);
  const lo = Number.parseInt(mapped[2], 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** Remote hero URLs only. Refuses http, localhost, and private addresses. */
export function isPublicHttpsImageUrl(sourceUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal'
  ) {
    return false;
  }
  if (host === '::1' || isPrivateIpv4(host) || isPrivateIpv4(embeddedIpv4(host) ?? '')) {
    return false;
  }
  if (
    host.includes(':') &&
    (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))
  ) {
    return false;
  }
  return true;
}

/**
 * Copy a remote hero image into the public assets bucket.
 * Returns null when the response is not a small image; the event is still saved.
 */
export async function copyEventImage(input: {
  eventId: string;
  sourceUrl: string;
  role?: string;
  fetchImpl?: typeof fetch;
  put: (body: Uint8Array, contentType: string, key: string) => Promise<void>;
}): Promise<StoredEventImage | null> {
  if (!isPublicHttpsImageUrl(input.sourceUrl)) return null;
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.sourceUrl, {
      headers: { 'user-agent': 'LocalEventsBot/0.1 (+contact: set-me@example.com)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const contentType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
  if (!contentType.startsWith('image/')) return null;
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return null;
  const s3Key = eventImageKey(input.eventId, input.role ?? 'main');
  await input.put(body, contentType, s3Key);
  return { s3Key, contentType };
}

export function createS3EventImageUploader(options: {
  bucket: string;
  client?: S3Client;
  fetchImpl?: typeof fetch;
}): EventImageUploader {
  const client = options.client ?? s3ClientFromEnv();
  return {
    async put({ eventId, sourceUrl, role }) {
      return copyEventImage({
        eventId,
        sourceUrl,
        role,
        fetchImpl: options.fetchImpl,
        put: async (body, contentType, key) => {
          await client.send(
            new PutObjectCommand({
              Bucket: options.bucket,
              Key: key,
              Body: body,
              ContentType: contentType,
              CacheControl: 'public, max-age=86400',
            }),
          );
        },
      });
    },
  };
}

export function eventImageUploaderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EventImageUploader {
  const bucket = env.PUBLIC_ASSETS_BUCKET?.trim();
  if (!bucket) return noopEventImageUploader;
  return createS3EventImageUploader({ bucket, client: s3ClientFromEnv(env) });
}

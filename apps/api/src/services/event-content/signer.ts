import type { ContentUrlSigner } from './types';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/** Dev/test signer — no AWS. Prod will use CloudFront/S3 presign with the same interface. */
export function createMemoryContentUrlSigner(
  now: () => Date = () => new Date(),
  ttlMs = DEFAULT_TTL_MS,
): ContentUrlSigner {
  return {
    async sign(s3Key: string) {
      const expiresAt = new Date(now().getTime() + ttlMs);
      const url = `https://files.local/signed?key=${encodeURIComponent(s3Key)}&exp=${expiresAt.toISOString()}`;
      return { url, expiresAt };
    },
  };
}

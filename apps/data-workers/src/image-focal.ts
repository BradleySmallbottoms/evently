import { imageFocalPoint, type ImageFocal } from '@local-events/domain';
import { tryHoldAdvisoryLock } from '@local-events/db';

import { readPublicImage } from './image-bytes';
import { completeChatImage, hasChatEndpoint, type ChatImage } from './prompt-runners/chatwithtools';
import { createRunpodChat, runpodChatConfigFromEnv, type RunpodChat } from './runpod-chat';
import type { IngestStore, PendingImageFocalRow } from './store';

export const IMAGE_FOCAL_BATCH_LIMIT = 5;
/** Long enough for one model call per image in the batch. */
export const IMAGE_FOCAL_LEASE_MS = 10 * 60 * 1000;
/** The scan pod stays up for the whole drain, so each claim can wait. */
export const IMAGE_FOCAL_POD_LEASE_MS = 30 * 60 * 1000;
/** Chat image limits sit near 5 MB. A larger file is stored as failed. */
export const IMAGE_FOCAL_MAX_BYTES = 4_500_000;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IMAGE_FOCAL_PROMPT = [
  'This photo is cropped to fill a tall phone screen. The bottom of that screen is covered by the event title.',
  'Reply with JSON only: {"x": number, "y": number}.',
  'x is how far across the image the most interesting point sits, from 0 on the left to 1 on the right.',
  'y is how far down, from 0 at the top to 1 at the bottom.',
  'Pick a point that should stay visible, such as a face, a performer, or the main subject.',
  'Do not pick a logo, a border, or empty background.',
].join(' ');

export interface ImageFocalSummary {
  claimed: number;
  done: number;
  failed: number;
  unavailable: number;
  /** Unavailable rows whose chat request timed out. Already included in `unavailable`. */
  unavailable_timeout: number;
  /** Rows this call released so a later run can claim them. */
  released: string[];
  imageIds: string[];
}

export interface ImageFocalPodSummary extends ImageFocalSummary {
  /** `busy` means the scan lock is held. `idle` means the queue was empty. */
  pod: 'busy' | 'idle' | 'ran';
}

type Ask = (image: ChatImage) => Promise<{ text: string; output: object } | 'timeout' | null>;

/** Reads `--image` / `--limit` (or `IMAGE_ID` / `SCAN_LIMIT`) for a manual run. */
export function parseImageFocalSelection(input: {
  imageId?: string;
  limit?: string;
}): { ok: true; imageId?: string; limit?: number } | { ok: false; message: string } {
  const limited = parseLimit(input.limit);
  if (!limited.ok) return limited;
  if (input.imageId == null || input.imageId.trim() === '') {
    return { ok: true, ...(limited.limit != null ? { limit: limited.limit } : {}) };
  }
  const imageId = input.imageId.trim();
  if (!IMAGE_ID.test(imageId)) return { ok: false, message: '--image must be an image id' };
  return { ok: true, imageId, ...(limited.limit != null ? { limit: limited.limit } : {}) };
}

function parseLimit(
  limit: string | undefined,
): { ok: true; limit?: number } | { ok: false; message: string } {
  const raw = limit?.trim();
  if (raw == null || raw === '') return { ok: true };
  if (!/^[1-9]\d{0,2}$/.test(raw)) {
    return { ok: false, message: '--limit must be a whole number from 1 to 999' };
  }
  return { ok: true, limit: Number(raw) };
}

/** The first JSON object in a model reply, when it is a point on the photo. */
export function focalFromModelText(text: string): ImageFocal | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return imageFocalPoint(JSON.parse(body.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function mediaType(contentType: string): string | null {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return IMAGE_TYPES.has(type) ? type : null;
}

function emptySummary(): ImageFocalSummary {
  return {
    claimed: 0,
    done: 0,
    failed: 0,
    unavailable: 0,
    unavailable_timeout: 0,
    released: [],
    imageIds: [],
  };
}

/**
 * Claims images with no focal point and asks the scan chat model where to crop.
 * A poster is left out. A transport failure releases the lease. An answer that
 * is not a point is stored as `failed`.
 */
export async function scanPendingImageFocals(
  store: IngestStore,
  options: {
    limit?: number;
    leaseMs?: number;
    imageId?: string;
    skipImageIds?: readonly string[];
    readImage?: (row: PendingImageFocalRow) => Promise<Uint8Array | null>;
    ask?: Ask;
    fetch?: typeof fetch;
    config?: Record<string, unknown>;
  } = {},
): Promise<ImageFocalSummary> {
  const limit = options.limit ?? IMAGE_FOCAL_BATCH_LIMIT;
  const leaseMs = options.leaseMs ?? IMAGE_FOCAL_LEASE_MS;
  const claimed = await store.claimPendingImageFocals(
    limit,
    leaseMs,
    options.imageId,
    options.skipImageIds,
  );
  const summary: ImageFocalSummary = { ...emptySummary(), claimed: claimed.length };
  if (claimed.length === 0) return summary;
  const readImage = options.readImage ?? ((row) => readPublicImage(row.s3Key));
  const ask =
    options.ask ??
    ((image: ChatImage) =>
      completeChatImage(options.config ?? {}, IMAGE_FOCAL_PROMPT, image, options.fetch ?? fetch));
  for (const row of claimed) {
    summary.imageIds.push(row.imageId);
    const outcome = await scanOne(row, readImage, ask);
    if (outcome.kind === 'release') {
      await store.releaseImageFocalClaim(row.imageId, row.claimedUntil);
      summary.unavailable += 1;
      summary.released.push(row.imageId);
      if (outcome.timeout) summary.unavailable_timeout += 1;
      continue;
    }
    const wrote =
      outcome.kind === 'done'
        ? await store.finishImageFocal({
            imageId: row.imageId,
            claimedUntil: row.claimedUntil,
            x: outcome.point.x,
            y: outcome.point.y,
            output: outcome.output,
          })
        : await store.failImageFocal({
            imageId: row.imageId,
            claimedUntil: row.claimedUntil,
            output: outcome.output,
          });
    if (!wrote) {
      summary.unavailable += 1;
      summary.released.push(row.imageId);
      continue;
    }
    if (outcome.kind === 'done') summary.done += 1;
    else summary.failed += 1;
  }
  return summary;
}

type One =
  | { kind: 'done'; point: ImageFocal; output: object }
  | { kind: 'fail'; output: object }
  | { kind: 'release'; timeout: boolean };

async function scanOne(
  row: PendingImageFocalRow,
  readImage: (row: PendingImageFocalRow) => Promise<Uint8Array | null>,
  ask: Ask,
): Promise<One> {
  const type = mediaType(row.contentType);
  if (!type) return { kind: 'fail', output: { error: 'unsupported_type' } };
  const bytes = await readImage(row);
  if (!bytes || bytes.byteLength === 0) return { kind: 'fail', output: { error: 'missing' } };
  if (bytes.byteLength > IMAGE_FOCAL_MAX_BYTES)
    return { kind: 'fail', output: { error: 'too_large' } };
  const answer = await ask({ mediaType: type, base64: Buffer.from(bytes).toString('base64') });
  if (answer === 'timeout') return { kind: 'release', timeout: true };
  if (!answer) return { kind: 'release', timeout: false };
  const point = focalFromModelText(answer.text);
  if (!point) return { kind: 'fail', output: answer.output };
  return { kind: 'done', point, output: answer.output };
}

/**
 * `CHAT_PROVIDER=runpod` holds the scan lock, starts the scan pod, and drains
 * pending images. The pod stops when the queue is empty or this run ends.
 */
export async function scanImageFocalsWithChatPod(input: {
  store: IngestStore;
  databaseUrl: string;
  selection?: { imageId?: string; limit?: number };
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  holdLock?: typeof tryHoldAdvisoryLock;
  chat?: RunpodChat;
  readImage?: (row: PendingImageFocalRow) => Promise<Uint8Array | null>;
}): Promise<ImageFocalPodSummary> {
  const env = input.env ?? process.env;
  let chat = input.chat;
  if (!chat) {
    const config = runpodChatConfigFromEnv(env);
    if ('error' in config) throw new Error(config.error);
    chat = createRunpodChat(config, { ...(input.fetch ? { fetch: input.fetch } : {}) });
  }
  const hold = await (input.holdLock ?? tryHoldAdvisoryLock)(input.databaseUrl);
  if (!hold) return { ...emptySummary(), pod: 'busy' };

  let summary: ImageFocalPodSummary | undefined;
  let failure: unknown;
  try {
    const pending = await input.store.countPendingImageFocals(input.selection?.imageId);
    if (pending === 0) {
      await chat.stopIfRunning();
      summary = { ...emptySummary(), pod: 'idle' };
    } else {
      const ready = await chat.ensureReady();
      const drained = await drainImageFocals(input.store, input.selection, {
        ...(input.fetch ? { fetch: input.fetch } : {}),
        ...(input.readImage ? { readImage: input.readImage } : {}),
        config: {
          chatProvider: 'openai',
          chatUrl: ready.chatUrl,
          chatModel: ready.model,
          chatAuth: ready.auth,
        },
      });
      summary = { ...drained, pod: 'ran' };
    }
  } catch (err) {
    failure = err;
  } finally {
    try {
      await chat.stop();
    } catch (err) {
      console.error(err);
      failure ??= err;
    }
    await hold.release();
  }
  if (failure) throw failure;
  return summary ?? { ...emptySummary(), pod: 'ran' };
}

async function drainImageFocals(
  store: IngestStore,
  selection: { imageId?: string; limit?: number } = {},
  options: {
    fetch?: typeof fetch;
    config?: Record<string, unknown>;
    readImage?: (row: PendingImageFocalRow) => Promise<Uint8Array | null>;
  },
): Promise<ImageFocalSummary> {
  const totals = emptySummary();
  const skip = new Set<string>();
  const oneBatch = selection.imageId != null || selection.limit != null;
  for (;;) {
    const summary = await scanPendingImageFocals(store, {
      leaseMs: IMAGE_FOCAL_POD_LEASE_MS,
      limit: selection.limit ?? IMAGE_FOCAL_BATCH_LIMIT,
      ...(selection.imageId ? { imageId: selection.imageId } : {}),
      skipImageIds: [...skip],
      ...options,
    });
    totals.claimed += summary.claimed;
    totals.done += summary.done;
    totals.failed += summary.failed;
    totals.unavailable += summary.unavailable;
    totals.unavailable_timeout += summary.unavailable_timeout;
    totals.released.push(...summary.released);
    totals.imageIds.push(...summary.imageIds);
    for (const id of summary.released) skip.add(id);
    if (oneBatch || summary.claimed === 0) return totals;
  }
}

/** The local and hosted scan chat can be called. Runpod is started by the pod path. */
export function imageFocalChatReady(config: Record<string, unknown> = {}): boolean {
  return hasChatEndpoint(config);
}

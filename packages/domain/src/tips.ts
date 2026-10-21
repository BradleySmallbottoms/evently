import { organizerKeys } from './organizer-keys';

/** Free-text step on the tip screen. */
export const TIP_TEXT_MAX = 500;
/** Poster upload cap. Matches the event image copier. */
export const TIP_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const TIP_IMAGE_MAX_COUNT = 4;
/** Submitted tips per user, rolling 24 hours. Also the cap on unfinished tips. */
export const TIP_DAILY_LIMIT = 10;
/** Profile list page size. */
export const TIP_LIST_LIMIT = 100;
/** Base64 length of an 8 MB poster. The upload body is rejected at this size. */
export const TIP_IMAGE_BASE64_MAX = Math.ceil(TIP_IMAGE_MAX_BYTES / 3) * 4;
/** A vision read still marked scanning after this is started again. */
export const TIP_VISION_STALE_MS = 30_000;

export const TIP_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export type TipImageType = (typeof TIP_IMAGE_TYPES)[number];
export type TipPath = 'photo' | 'text';
export type TipStatus = 'collecting' | 'needs_input' | 'submitted' | 'scanned' | 'failed';
export type TipLocale = 'sv' | 'en';

/** Fields the model may fill. Empty string and null mean unknown. */
export interface TipExtraction {
  title?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  place?: string | null;
  priceLabel?: string | null;
  /** Minor units. 0 is free. Null is unknown. */
  priceAmount?: number | null;
  link?: string | null;
  organizerName?: string | null;
  description?: string | null;
  categoryHint?: string | null;
}

export interface TipCard {
  title: string | null;
  startsAt: string | null;
  place: string | null;
  priceLabel: string | null;
  link: string | null;
}

export type TipPhase =
  | 'collecting'
  | 'scanning'
  | 'confirm'
  | 'follow_up'
  | 'receipt'
  | 'published'
  | 'review'
  | 'failed';

const FREE_PRICE = /^(gratis|fri entré|fritt inträde|kostnadsfritt|free)$/i;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function emptyTipExtraction(): TipExtraction {
  return {
    title: null,
    startsAt: null,
    endsAt: null,
    place: null,
    priceLabel: null,
    priceAmount: null,
    link: null,
    organizerName: null,
    description: null,
    categoryHint: null,
  };
}

/** Later non-empty values replace earlier ones. Null does not wipe a filled field. */
export function mergeTipExtraction(base: TipExtraction, patch: TipExtraction): TipExtraction {
  const next = { ...emptyTipExtraction(), ...base };
  for (const key of Object.keys(emptyTipExtraction()) as (keyof TipExtraction)[]) {
    const value = patch[key];
    if (key === 'priceAmount' && typeof value === 'number' && Number.isFinite(value)) {
      next.priceAmount = Math.max(0, Math.round(value));
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      (next[key] as string | null) = value.trim();
    }
  }
  if (next.priceAmount == null && next.priceLabel && FREE_PRICE.test(next.priceLabel)) {
    next.priceAmount = 0;
  }
  return next;
}

export function tipCard(extraction: TipExtraction): TipCard {
  return {
    title: clean(extraction.title),
    startsAt: clean(extraction.startsAt),
    place: clean(extraction.place),
    priceLabel: clean(extraction.priceLabel),
    link: clean(extraction.link),
  };
}

export function hasUsableTitle(extraction: TipExtraction): boolean {
  return (clean(extraction.title)?.length ?? 0) >= 2;
}

/**
 * Text tips ask for a category, a photo, and a short description when any of
 * those is still empty. A photo with a title can be submitted as it is.
 */
export function needsTipFollowUp(input: {
  path: TipPath;
  extraction: TipExtraction;
  hasImage: boolean;
}): boolean {
  if (input.path === 'photo') return !hasUsableTitle(input.extraction);
  return (
    !clean(input.extraction.categoryHint) || !input.hasImage || !clean(input.extraction.description)
  );
}

export function tipPhase(input: {
  path: TipPath;
  status: TipStatus;
  scanStatus: string | null;
  imageStatus: 'none' | 'scanning' | 'ready' | 'failed';
  hasExtraction: boolean;
}): TipPhase {
  if (input.status === 'failed' || input.scanStatus === 'failed') return 'failed';
  if (input.status === 'scanned' && input.scanStatus === 'published') return 'published';
  if (input.status === 'scanned') return 'review';
  if (input.status === 'submitted') return 'receipt';
  if (input.status === 'needs_input') return 'follow_up';
  if (input.path === 'photo' && input.imageStatus === 'scanning') return 'scanning';
  if (input.path === 'text' && input.hasExtraction) return 'confirm';
  return 'collecting';
}

export function fallbackTipTitle(input: {
  title?: string | null;
  text?: string | null;
  locale: TipLocale;
}): string {
  const title = clean(input.title);
  if (title && title.length >= 2) return title.slice(0, 200);
  const line = clean(input.text)?.split('\n')[0];
  if (line && line.length >= 2) return line.slice(0, 200);
  return input.locale === 'en' ? 'Tipped event' : 'Tipsat evenemang';
}

export function tipOpenAllowed(
  openCount: number,
): { ok: true } | { ok: false; reason: 'open_limit' } {
  if (openCount >= TIP_DAILY_LIMIT) return { ok: false, reason: 'open_limit' };
  return { ok: true };
}

export function tipSubmissionAllowed(
  submittedToday: number,
): { ok: true } | { ok: false; reason: 'daily_limit' } {
  if (submittedToday >= TIP_DAILY_LIMIT) return { ok: false, reason: 'daily_limit' };
  return { ok: true };
}

export function tipImageAllowed(input: {
  contentType: string;
  byteLength: number;
  existingCount: number;
}): { ok: true } | { ok: false; reason: 'unsupported_type' | 'too_large' | 'too_many' } {
  if (!TIP_IMAGE_TYPES.includes(input.contentType as TipImageType)) {
    return { ok: false, reason: 'unsupported_type' };
  }
  if (input.byteLength > TIP_IMAGE_MAX_BYTES || input.byteLength < 1) {
    return { ok: false, reason: 'too_large' };
  }
  if (input.existingCount >= TIP_IMAGE_MAX_COUNT) return { ok: false, reason: 'too_many' };
  return { ok: true };
}

export function visionIsStale(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() >= TIP_VISION_STALE_MS;
}

/** ISO-8601 only. A display string stays on the card and is not a timestamp. */
export function tipInstant(value: string | null | undefined): Date | null {
  const raw = clean(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function tipOrganizerKeys(input: {
  tipId: string;
  organizerName?: string | null;
  link?: string | null;
}): string[] {
  return organizerKeys({
    names: [input.organizerName],
    infoUrls: [input.link],
    fallback: `tip:${input.tipId}`,
  });
}

export function tipScanNotification(input: {
  locale: TipLocale;
  status: 'published' | 'in_review' | 'failed' | 'needs_input';
  title: string;
  place: string | null;
}): { title: string; body: string } {
  const place = clean(input.place);
  const name = input.title.trim() || (input.locale === 'en' ? 'the event' : 'eventet');
  if (input.locale === 'en') {
    if (input.status === 'published') {
      return {
        title: 'Your event is ready!',
        body: place
          ? `We added ${name} at ${place}. Thanks for the tip!`
          : `We added ${name}. Thanks for the tip!`,
      };
    }
    if (input.status === 'needs_input') {
      return {
        title: 'We need a bit more',
        body: 'The photo did not include enough to add the event. You can fill in the rest.',
      };
    }
    if (input.status === 'failed') {
      return {
        title: 'We could not check the tip',
        body: 'Something went wrong while reading the event. You can see the status in your tips.',
      };
    }
    return {
      title: 'We are checking your tip',
      body: `${name} is in review. We will add it after a check.`,
    };
  }
  if (input.status === 'published') {
    return {
      title: 'Ditt event är klart!',
      body: place
        ? `Vi har lagt till ${name} i ${place}. Tack för ditt tips!`
        : `Vi har lagt till ${name}. Tack för ditt tips!`,
    };
  }
  if (input.status === 'needs_input') {
    return {
      title: 'Vi behöver lite mer',
      body: 'Bilden räckte inte för att lägga till eventet. Du kan fylla i resten.',
    };
  }
  if (input.status === 'failed') {
    return {
      title: 'Vi kunde inte granska tipset',
      body: 'Något gick fel när vi läste eventet. Du kan se status under dina tips.',
    };
  }
  return {
    title: 'Vi granskar ditt tips',
    body: `${name} väntar på en kontroll. Vi lägger till det efter det.`,
  };
}

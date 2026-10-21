import type { Tip, TipFound } from '@local-events/contracts';
import {
  emptyTipExtraction,
  publicAssetUrl,
  tipCard,
  tipPhase,
  type TipExtraction,
} from '@local-events/domain';
import type { TipImageRecord, TipRecord } from './repo';

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function imageStatusOf(images: TipImageRecord[]): 'none' | 'scanning' | 'ready' | 'failed' {
  if (images.some((image) => image.status === 'scanning')) return 'scanning';
  if (images.some((image) => image.status === 'ready')) return 'ready';
  if (images.some((image) => image.status === 'failed')) return 'failed';
  return 'none';
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function foundFor(tip: TipRecord, extraction: TipExtraction): TipFound | null {
  const title = tip.eventTitle ?? clean(extraction.title);
  const description = tip.eventDescription ?? clean(extraction.description);
  const place = tip.eventPlace ?? clean(extraction.place);
  const startsAt = tip.eventStartsAt?.toISOString() ?? clean(extraction.startsAt);
  const priceLabel = tip.eventPriceAmount === 0 ? 'Gratis' : clean(extraction.priceLabel);
  const category = clean(extraction.categoryHint);
  if (!title && !description && !place && !startsAt && !priceLabel && !category) return null;
  return {
    title,
    startsAt,
    place,
    priceLabel,
    category,
    description,
  };
}

export function presentTip(
  tip: TipRecord,
  images: TipImageRecord[],
  assetsPublicBaseUrl?: string,
): Tip {
  const extraction = { ...emptyTipExtraction(), ...tip.extracted };
  const imageStatus = imageStatusOf(images);
  const hasExtraction = Object.values(extraction).some((value) => value != null && value !== '');
  const phase = tipPhase({
    path: tip.path,
    status: tip.status,
    scanStatus: tip.scanStatus,
    imageStatus,
    hasExtraction,
  });
  const ready = images.find((image) => image.status === 'ready');
  return {
    id: tip.id,
    path: tip.path,
    status: tip.status,
    phase,
    locale: tip.locale,
    card: hasExtraction ? tipCard(extraction) : null,
    followUp:
      phase === 'follow_up'
        ? {
            category: !clean(extraction.categoryHint),
            image: !ready,
            description: !clean(extraction.description),
          }
        : null,
    eventId: tip.eventId,
    scanStatus: tip.scanStatus,
    imageStatus,
    timeline: {
      submittedAt: iso(tip.submittedAt),
      analyzedAt: iso(tip.analyzedAt),
      completedAt: iso(tip.completedAt),
      reviewedAt: iso(tip.reviewedAt),
    },
    found: foundFor(tip, extraction),
    previewImageUrl: publicAssetUrl(assetsPublicBaseUrl, ready?.s3Key),
    createdAt: tip.createdAt.toISOString(),
  };
}

import type { Tip, TipFound } from '@local-events/contracts';
import {
  emptyTipExtraction,
  publicAssetUrl,
  shownTipOptions,
  tipAskFromBody,
  tipCard,
  tipDetailProgress,
  tipFollowUpQuestion,
  tipPendingConfirm,
  tipPhase,
  type TipExtraction,
} from '@local-events/domain';
import type { TipImageRecord, TipMessageRecord, TipRecord } from './repo';

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
  messages: TipMessageRecord[] = [],
): Tip {
  const extraction = { ...emptyTipExtraction(), ...tip.extracted };
  const imageStatus = imageStatusOf(images);
  const hasExtraction = Object.values(extraction).some((value) => value != null && value !== '');
  const progress = tipDetailProgress(extraction);
  const imageSettled =
    Boolean(extraction.imageDeclined) || (images.length > 0 && imageStatus !== 'scanning');
  const phase = tipPhase({
    path: tip.path,
    status: tip.status,
    scanStatus: tip.scanStatus,
    imageStatus,
    hasExtraction,
    detailsComplete:
      progress.missing.length === 0 && imageSettled && !tipPendingConfirm(extraction),
  });
  const photo = images.find((image) => image.status !== 'failed') ?? images[0];
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
            category: false,
            image: false,
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
    previewImageUrl: publicAssetUrl(assetsPublicBaseUrl, photo?.s3Key),
    progress: { done: progress.done, total: progress.total },
    messages: messages.map((message) => {
      const ask = message.role === 'assistant' ? tipAskFromBody(message.body) : null;
      return {
        role: message.role,
        body: ask?.question ?? message.body,
        key: ask?.key ?? null,
        options: ask ? shownTipOptions(ask, tip.locale) : [],
        createdAt: message.createdAt.toISOString(),
      };
    }),
    question: (() => {
      if (phase !== 'collecting') return null;
      const last = [...messages].reverse().find((message) => message.role === 'assistant');
      const ask = last ? tipAskFromBody(last.body) : null;
      const next = tipFollowUpQuestion({
        questions: ask ? [ask] : [],
        missing: progress.missing,
        locale: tip.locale,
        extraction,
        image: extraction.imageDeclined
          ? 'declined'
          : imageStatus === 'scanning'
            ? 'scanning'
            : imageStatus === 'ready'
              ? 'ready'
              : 'missing',
      });
      return next
        ? { key: next.key, question: next.question, options: shownTipOptions(next, tip.locale) }
        : null;
    })(),
    createdAt: tip.createdAt.toISOString(),
    warning: null,
  };
}

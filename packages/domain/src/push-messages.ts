import { eventNotificationCopy, type NotificationReason } from './notifications';

/** Defer delivery when another matching message is due within this window. */
export const PUSH_AGGREGATION_WINDOW_MS = 10 * 60 * 1000;

/** Soft cap for broadcast fan-out (everyone / tag interest). */
export const BROADCAST_MATCH_LIMIT = 5_000;

export type PushMessageStatus =
  | 'pending'
  | 'approved'
  | 'sending'
  | 'sent'
  | 'rejected'
  | 'cancelled';

/** Statuses that block creating a second open draft for the same event. */
export const OPEN_PUSH_MESSAGE_STATUSES: readonly PushMessageStatus[] = [
  'pending',
  'approved',
  'sending',
  'rejected',
] as const;

export function isOpenPushMessageStatus(status: PushMessageStatus): boolean {
  return (OPEN_PUSH_MESSAGE_STATUSES as readonly string[]).includes(status);
}

/** Trusted native publishers and mapped auto_publish imports skip admin approval. */
export function shouldAutoApprovePushMessage(input: {
  publisherVerified: boolean;
  origin: 'native' | 'imported';
  sourceTrust?: 'auto_publish' | 'review';
  publisherIsTemporary?: boolean;
}): boolean {
  if (input.origin === 'imported') {
    if (input.publisherIsTemporary) return false;
    return input.sourceTrust === 'auto_publish';
  }
  return input.publisherVerified;
}

export function initialPushMessageStatus(autoApprove: boolean): 'pending' | 'approved' {
  return autoApprove ? 'approved' : 'pending';
}

/**
 * After an untrusted edit of copy/schedule on an approved draft, require approval again.
 * Trusted editors keep approved.
 */
export function statusAfterDraftEdit(input: {
  current: PushMessageStatus;
  autoApprove: boolean;
}): PushMessageStatus {
  if (input.current === 'sent' || input.current === 'sending' || input.current === 'cancelled') {
    return input.current;
  }
  if (input.autoApprove) return 'approved';
  return 'pending';
}

/** Whether the publisher may create a new draft (previous must be sent or cancelled). */
export function canCreateNewPushDraft(openStatus: PushMessageStatus | null): boolean {
  return openStatus === null;
}

export type PushMessageCopy = {
  titleSv: string;
  bodySv: string;
  titleEn: string;
  bodyEn: string;
};

/** Default bilingual copy from the event title and nearby reason. */
export function defaultPushMessageCopy(
  eventTitle: string,
  reason: NotificationReason = 'nearby',
): PushMessageCopy {
  const sv = eventNotificationCopy('sv', eventTitle, reason);
  const en = eventNotificationCopy('en', eventTitle, reason);
  return {
    titleSv: sv.title,
    bodySv: sv.body,
    titleEn: en.title,
    bodyEn: en.body,
  };
}

/** Secondary line for aggregated silent-push payload / local OS notification. */
export function aggregatedMoreCopy(locale: string, moreCount: number): string {
  if (moreCount <= 0) return '';
  if (locale.startsWith('en')) {
    return moreCount === 1 ? 'And 1 more…' : `And ${moreCount} more…`;
  }
  return moreCount === 1 ? 'Och 1 till…' : `Och ${moreCount} till…`;
}

export type PushBundleItem = {
  id: string;
  sendAt: Date | null;
  titleSv: string;
  bodySv: string;
  titleEn: string;
  bodyEn: string;
};

/** Earliest by send_at (null = immediate), then id. */
export function pickPrimaryPushMessage<T extends PushBundleItem>(items: readonly T[]): T {
  if (items.length === 0) throw new Error('empty_push_bundle');
  return [...items].sort((a, b) => {
    const aAt = a.sendAt?.getTime() ?? 0;
    const bAt = b.sendAt?.getTime() ?? 0;
    if (aAt !== bAt) return aAt - bAt;
    return a.id.localeCompare(b.id);
  })[0]!;
}

export function localizedPushCopy(
  locale: string,
  item: Pick<PushBundleItem, 'titleSv' | 'bodySv' | 'titleEn' | 'bodyEn'>,
): { title: string; body: string } {
  if (locale.startsWith('en')) {
    return { title: item.titleEn, body: item.bodyEn };
  }
  return { title: item.titleSv, body: item.bodySv };
}

/**
 * Build Expo/local notification title + body for a one-or-more bundle.
 * Primary text from the earliest message; secondary “And N more…” when N ≥ 1.
 */
export function bundledPushPresentation(
  locale: string,
  items: readonly PushBundleItem[],
): { title: string; body: string; moreCount: number } {
  const primary = pickPrimaryPushMessage(items);
  const copy = localizedPushCopy(locale, primary);
  const moreCount = Math.max(0, items.length - 1);
  if (moreCount === 0) return { ...copy, moreCount: 0 };
  const more = aggregatedMoreCopy(locale, moreCount);
  return {
    title: copy.title,
    body: `${copy.body}\n${more}`,
    moreCount,
  };
}

/** True when `candidateSendAt` falls in [now, now + window] (null send_at = due now). */
export function isWithinAggregationWindow(
  now: Date,
  candidateSendAt: Date | null,
  windowMs: number = PUSH_AGGREGATION_WINDOW_MS,
): boolean {
  const due = candidateSendAt?.getTime() ?? now.getTime();
  const t = now.getTime();
  return due >= t && due <= t + windowMs;
}

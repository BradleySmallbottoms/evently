import type { NotificationTipStatus } from '@local-events/contracts';

const TIP_STATUSES: readonly NotificationTipStatus[] = [
  'published',
  'in_review',
  'failed',
  'needs_input',
];

function tipStatus(value: string | null | undefined): NotificationTipStatus | null {
  if (!value) return null;
  return TIP_STATUSES.includes(value as NotificationTipStatus)
    ? (value as NotificationTipStatus)
    : null;
}

/** Headline, body, and tip state stored on the push that created the inbox row. */
export function notificationMessageFields(
  message:
    | {
        titleSv: string;
        titleEn: string;
        bodySv: string;
        bodyEn: string;
        kind: string;
        tipStatus: string | null;
      }
    | null
    | undefined,
) {
  return {
    titleSv: message?.titleSv ?? null,
    titleEn: message?.titleEn ?? null,
    bodySv: message?.bodySv ?? null,
    bodyEn: message?.bodyEn ?? null,
    tipStatus: message?.kind === 'tip' ? tipStatus(message.tipStatus) : null,
  };
}

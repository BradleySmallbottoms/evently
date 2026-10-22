const EVENT_NOTIFICATION_KINDS = new Set(['reminder', 'inbox', 'local_inbox']);
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recordOf(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

/** Tip id to open when a tip scan notification arrives or is tapped. */
export function tipIdFromNotificationData(data: unknown): string | null {
  const record = recordOf(data);
  if (!record || record.kind !== 'tip_scan') return null;
  if (typeof record.tipId !== 'string') return null;
  const tipId = record.tipId.trim();
  return EVENT_ID.test(tipId) ? tipId : null;
}

/**
 * Where a tip notification opens. A published tip uses the thank-you screen.
 * Any other result uses the tip status.
 */
export function tipTargetFromNotificationData(
  data: unknown,
): { tipId: string; screen: 'published' | 'status' } | null {
  const tipId = tipIdFromNotificationData(data);
  const record = recordOf(data);
  if (!tipId || !record) return null;
  return {
    tipId,
    screen: record.status === 'published' ? 'published' : 'status',
  };
}

/** Event id to open when the user taps a notification. Null for broadcasts and other payloads. */
export function eventIdFromNotificationData(data: unknown): string | null {
  const record = recordOf(data);
  if (!record) return null;
  if (typeof record.kind !== 'string' || !EVENT_NOTIFICATION_KINDS.has(record.kind)) return null;
  if (typeof record.eventId !== 'string') return null;
  const eventId = record.eventId.trim();
  return EVENT_ID.test(eventId) ? eventId : null;
}

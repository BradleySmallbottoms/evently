const EVENT_NOTIFICATION_KINDS = new Set(['reminder', 'inbox', 'local_inbox']);
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tip id to open when a tip scan notification arrives or is tapped. */
export function tipIdFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.kind !== 'tip_scan') return null;
  if (typeof record.tipId !== 'string') return null;
  const tipId = record.tipId.trim();
  return EVENT_ID.test(tipId) ? tipId : null;
}

/** Event id to open when the user taps a notification. Null for broadcasts and other payloads. */
export function eventIdFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.kind !== 'string' || !EVENT_NOTIFICATION_KINDS.has(record.kind)) return null;
  if (typeof record.eventId !== 'string') return null;
  const eventId = record.eventId.trim();
  return EVENT_ID.test(eventId) ? eventId : null;
}

const EVENT_NOTIFICATION_KINDS = new Set(['reminder', 'inbox', 'local_inbox']);
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Event id to open when the user taps a notification. Null for broadcasts and other payloads. */
export function eventIdFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.kind !== 'string' || !EVENT_NOTIFICATION_KINDS.has(record.kind)) return null;
  if (typeof record.eventId !== 'string') return null;
  const eventId = record.eventId.trim();
  return EVENT_ID.test(eventId) ? eventId : null;
}

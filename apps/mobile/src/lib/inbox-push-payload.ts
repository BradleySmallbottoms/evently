export type InboxPushFields = {
  kind: 'inbox';
  notificationId?: string;
  eventId?: string;
  reason?: string;
  eventTitle?: string;
  title?: string;
  body?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Inbox fields from a plain object. Returns null unless `kind` is `inbox`. */
export function readInboxPushFields(value: unknown): InboxPushFields | null {
  if (!isRecord(value) || value.kind !== 'inbox') return null;
  return {
    kind: 'inbox',
    notificationId: str(value, 'notificationId'),
    eventId: str(value, 'eventId'),
    reason: str(value, 'reason'),
    eventTitle: str(value, 'eventTitle'),
    title: str(value, 'title'),
    body: str(value, 'body'),
  };
}

function readJsonInbox(raw: string): InboxPushFields | null {
  try {
    return readInboxPushFields(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Expo's background task receives the raw APNs/FCM payload, not a Notification.
 * The push `data` object may arrive as `data.dataString`, as `data.body`, or
 * flattened onto `data`.
 */
export function inboxPushFieldsFromTaskPayload(payload: unknown): InboxPushFields | null {
  if (!isRecord(payload) || 'actionIdentifier' in payload) return null;
  const data = isRecord(payload.data) ? payload.data : payload;

  if (typeof data.dataString === 'string') {
    const parsed = readJsonInbox(data.dataString);
    if (parsed) return parsed;
  }

  if (typeof data.body === 'string') {
    const parsed = readJsonInbox(data.body);
    if (parsed) return parsed;
  } else {
    const nested = readInboxPushFields(data.body);
    if (nested) return nested;
  }

  return readInboxPushFields(data);
}

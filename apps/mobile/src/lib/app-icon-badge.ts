export type AppIconBadgeUpdate = {
  /** Unread count from the push. Null means this delivery should add one. */
  count: number | null;
  /** Same notification can arrive on the task and the foreground listener. */
  key: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Non-negative badge count from a number or a numeric string. */
export function finiteBadgeCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
}

function readJsonRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return isRecord(raw) ? raw : null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Inbox or tip fields from a background-task payload, wherever Expo nested them. */
function pushRecordFromTaskPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const data = isRecord(payload.data) ? payload.data : payload;
  return (
    readJsonRecord(data.dataString) ??
    readJsonRecord(data.body) ??
    (typeof data.kind === 'string' ? data : null)
  );
}

/**
 * Badge update for a remote push delivered to the headless task.
 * Notification taps and the local banner posted for a silent inbox push return null.
 */
export function badgeUpdateFromTaskPayload(payload: unknown): AppIconBadgeUpdate | null {
  if (!isRecord(payload) || 'actionIdentifier' in payload) return null;
  const record = pushRecordFromTaskPayload(payload);
  const kind = record ? str(record, 'kind') : undefined;
  if (kind === 'local_inbox') return null;

  const data = isRecord(payload.data) ? payload.data : null;
  const count =
    finiteBadgeCount(isRecord(payload.aps) ? payload.aps.badge : undefined) ??
    finiteBadgeCount(data?.badge) ??
    finiteBadgeCount(record?.badge);

  const id = record ? (str(record, 'notificationId') ?? str(record, 'tipId')) : undefined;
  const tracksBadge = kind === 'inbox' || kind === 'tip_scan' || kind === 'reminder';
  if (count == null && !tracksBadge) return null;
  return { count, key: id ? `${kind ?? 'push'}:${id}` : null };
}

/** Badge count carried on a notification the foreground listener already received. */
export function badgeCountFromNotification(input: {
  contentBadge?: unknown;
  data?: unknown;
}): number | null {
  const fromContent = finiteBadgeCount(input.contentBadge);
  if (fromContent != null) return fromContent;
  if (!isRecord(input.data)) return null;
  return finiteBadgeCount(input.data.badge);
}

/** Skip the local banner; the silent push that triggered it already updated the icon. */
export function isLocalInboxPush(data: unknown): boolean {
  return isRecord(data) && data.kind === 'local_inbox';
}

export function badgeApplyKey(data: unknown, fallback?: string | null): string | null {
  if (!isRecord(data) || data.kind === 'local_inbox') return null;
  const id = str(data, 'notificationId') ?? str(data, 'tipId');
  if (id) return `${str(data, 'kind') ?? 'push'}:${id}`;
  return fallback && fallback.length > 0 ? fallback : null;
}

/**
 * Count to write on the icon. Null leaves the current badge alone.
 * A duplicate delivery is ignored. While the app is active, only the foreground
 * listener applies the count; the headless task waits so opening the app wins.
 */
export function resolveAppIconBadge(input: {
  appIsActive: boolean;
  allowWhileActive: boolean;
  current: number;
  incoming: number | null;
  duplicate: boolean;
}): number | null {
  if (input.duplicate) return null;
  if (input.appIsActive && !input.allowWhileActive) return null;
  if (input.incoming != null) return input.incoming;
  const current =
    Number.isFinite(input.current) && input.current > 0 ? Math.floor(input.current) : 0;
  return current + 1;
}

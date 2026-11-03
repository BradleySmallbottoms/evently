/** Unread rows that arrived after the list was last opened. */
export function unreadSince(
  items: readonly { createdAt: string; readAt: string | null }[],
  seenAt: string | null,
): number {
  return items.filter((item) => item.readAt == null && (seenAt == null || item.createdAt > seenAt))
    .length;
}

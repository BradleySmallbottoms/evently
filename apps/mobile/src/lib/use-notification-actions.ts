import type { NotificationListResponse } from '@local-events/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { StoredIdentity } from './identity';
import { deleteNotification, markAllNotificationsRead, setNotificationRead } from './notifications';

/** Optimistic read and delete for the inbox query. */
export function useNotificationActions(identity: StoredIdentity | undefined) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState(false);
  const key = ['notifications', identity?.userId] as const;

  function update(recipe: (current: NotificationListResponse) => NotificationListResponse) {
    queryClient.setQueryData<NotificationListResponse>(key, (current) =>
      current ? recipe(current) : current,
    );
  }

  function fail() {
    setActionError(true);
    void queryClient.invalidateQueries({ queryKey: key });
  }

  const markRead = useMutation({
    mutationFn: (input: { id: string; read: boolean }) =>
      setNotificationRead(identity!, input.id, input.read),
    onMutate: ({ id, read }) => {
      setActionError(false);
      const now = new Date().toISOString();
      update((current) => {
        const target = current.items.find((item) => item.id === id);
        if (!target) return current;
        const wasUnread = target.readAt == null;
        const items = current.items.map((item) =>
          item.id === id ? { ...item, readAt: read ? (item.readAt ?? now) : null } : item,
        );
        const delta = read ? (wasUnread ? -1 : 0) : wasUnread ? 0 : 1;
        return { items, unreadCount: Math.max(0, current.unreadCount + delta) };
      });
    },
    onError: fail,
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(identity!),
    onMutate: () => {
      setActionError(false);
      const now = new Date().toISOString();
      update((current) => ({
        unreadCount: 0,
        items: current.items.map((item) => (item.readAt == null ? { ...item, readAt: now } : item)),
      }));
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteNotification(identity!, id),
    onMutate: (id) => {
      setActionError(false);
      update((current) => {
        const target = current.items.find((item) => item.id === id);
        return {
          items: current.items.filter((item) => item.id !== id),
          unreadCount:
            target?.readAt == null ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
        };
      });
    },
    onError: fail,
  });

  return {
    actionError,
    markRead: (id: string, read: boolean) => {
      if (!identity) return;
      markRead.mutate({ id, read });
    },
    markAllRead: () => {
      if (!identity) return;
      markAll.mutate();
    },
    remove: (id: string) => {
      if (!identity) return;
      remove.mutate(id);
    },
  };
}

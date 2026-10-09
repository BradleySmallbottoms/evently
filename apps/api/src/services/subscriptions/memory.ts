import type { CreateSubscriptionRequest, Subscription } from '@local-events/contracts';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { SubscriptionError, type SubscriptionServices } from './types';

function toSubscription(row: {
  targetType: 'publisher' | 'event';
  targetId: string;
  createdAt: Date;
}): Subscription {
  return {
    targetType: row.targetType,
    targetId: row.targetId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createMemorySubscriptionServices(
  auth: AuthServices,
  store: MemoryStore = createMemoryStore(),
  now: () => Date = () => new Date(),
): SubscriptionServices {
  const { subscriptions, publishers, events } = store;

  async function requireUser(sessionToken: string | undefined) {
    try {
      return await auth.requireUserSession(sessionToken);
    } catch (err) {
      if (err instanceof AuthError) throw new SubscriptionError('unauthorized');
      throw err;
    }
  }

  function assertTarget(targetType: 'publisher' | 'event', targetId: string) {
    if (targetType === 'publisher') {
      if (!publishers.has(targetId)) throw new SubscriptionError('invalid_target');
      return;
    }
    const event = events.get(targetId);
    if (!event || event.status !== 'published') throw new SubscriptionError('invalid_target');
  }

  return {
    async list(sessionToken) {
      const { userId } = await requireUser(sessionToken);
      return {
        items: subscriptions
          .filter((s) => s.userId === userId)
          .map(toSubscription)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    },

    async create(sessionToken, input: CreateSubscriptionRequest) {
      const { userId } = await requireUser(sessionToken);
      assertTarget(input.targetType, input.targetId);
      const existing = subscriptions.find(
        (s) =>
          s.userId === userId &&
          s.targetType === input.targetType &&
          s.targetId === input.targetId,
      );
      if (existing) return toSubscription(existing);
      const row = {
        userId,
        targetType: input.targetType,
        targetId: input.targetId,
        createdAt: now(),
      };
      subscriptions.push(row);
      return toSubscription(row);
    },

    async remove(sessionToken, targetType, targetId) {
      const { userId } = await requireUser(sessionToken);
      const idx = subscriptions.findIndex(
        (s) =>
          s.userId === userId && s.targetType === targetType && s.targetId === targetId,
      );
      if (idx < 0) throw new SubscriptionError('not_found');
      subscriptions.splice(idx, 1);
    },
  };
}

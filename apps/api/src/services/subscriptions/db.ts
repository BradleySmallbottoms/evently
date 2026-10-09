import type { CreateSubscriptionRequest, Subscription } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { and, desc, eq } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { SubscriptionError, type SubscriptionServices } from './types';

function mapRow(row: {
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

export function createDbSubscriptionServices(
  db: Db,
  auth: AuthServices,
  now: () => Date = () => new Date(),
): SubscriptionServices {
  async function requireUser(sessionToken: string | undefined) {
    try {
      return await auth.requireUserSession(sessionToken);
    } catch (err) {
      if (err instanceof AuthError) throw new SubscriptionError('unauthorized');
      throw err;
    }
  }

  async function assertTarget(targetType: 'publisher' | 'event', targetId: string) {
    if (targetType === 'publisher') {
      const [row] = await db
        .select({ id: schema.publishers.id })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, targetId))
        .limit(1);
      if (!row) throw new SubscriptionError('invalid_target');
      return;
    }
    const [row] = await db
      .select({ id: schema.events.id, status: schema.events.status })
      .from(schema.events)
      .where(eq(schema.events.id, targetId))
      .limit(1);
    if (!row || row.status !== 'published') throw new SubscriptionError('invalid_target');
  }

  return {
    async list(sessionToken) {
      const { userId } = await requireUser(sessionToken);
      const rows = await db
        .select({
          targetType: schema.subscriptions.targetType,
          targetId: schema.subscriptions.targetId,
          createdAt: schema.subscriptions.createdAt,
        })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, userId))
        .orderBy(desc(schema.subscriptions.createdAt));
      return { items: rows.map(mapRow) };
    },

    async create(sessionToken, input: CreateSubscriptionRequest) {
      const { userId } = await requireUser(sessionToken);
      await assertTarget(input.targetType, input.targetId);
      const at = now();
      await db
        .insert(schema.subscriptions)
        .values({
          userId,
          targetType: input.targetType,
          targetId: input.targetId,
          createdAt: at,
        })
        .onConflictDoNothing();
      const [row] = await db
        .select({
          targetType: schema.subscriptions.targetType,
          targetId: schema.subscriptions.targetId,
          createdAt: schema.subscriptions.createdAt,
        })
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.userId, userId),
            eq(schema.subscriptions.targetType, input.targetType),
            eq(schema.subscriptions.targetId, input.targetId),
          ),
        )
        .limit(1);
      if (!row) throw new SubscriptionError('not_found');
      return mapRow(row);
    },

    async remove(sessionToken, targetType, targetId) {
      const { userId } = await requireUser(sessionToken);
      const deleted = await db
        .delete(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.userId, userId),
            eq(schema.subscriptions.targetType, targetType),
            eq(schema.subscriptions.targetId, targetId),
          ),
        )
        .returning({ userId: schema.subscriptions.userId });
      if (deleted.length === 0) throw new SubscriptionError('not_found');
    },
  };
}

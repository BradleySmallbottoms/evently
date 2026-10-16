import type { CreateRatingRequest, Rating } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import {
  canComment,
  canRate,
  RATING_WINDOW_DAYS,
} from '@local-events/domain';
import { and, avg, count, eq, isNull } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { requirePublisherId } from '../publisher-id';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent } from '../domain-events/types';
import { RatingError, type RatingEnv, type RatingServices } from './types';

export function createDbRatingServices(
  db: Db,
  auth: AuthServices,
  env: RatingEnv = {},
): RatingServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();

  async function loadPublished(eventId: string) {
    const [row] = await db
      .select({
        id: schema.events.id,
        publisherId: schema.events.publisherId,
        status: schema.events.status,
        endsAt: schema.events.endsAt,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!row || row.status !== 'published') throw new RatingError('not_found');
    return row;
  }

  async function loadAggregate(eventId: string) {
    const [row] = await db
      .select({
        average: avg(schema.ratings.score),
        count: count(),
      })
      .from(schema.ratings)
      .where(and(eq(schema.ratings.eventId, eventId), isNull(schema.ratings.hiddenAt)));
    const n = Number(row?.count ?? 0);
    const average =
      row?.average == null || n === 0 ? null : Math.round(Number(row.average) * 10) / 10;
    return { average, count: n };
  }

  return {
    async getStatus(sessionToken, eventId) {
      const event = await loadPublished(eventId);
      const opensAt = event.endsAt;
      const closesAt = new Date(opensAt.getTime() + RATING_WINDOW_DAYS * 86_400_000);
      const agg = await loadAggregate(eventId);

      let hasRated = false;
      let myScore: number | null = null;
      let can = false;
      if (sessionToken) {
        try {
          const { userId } = await auth.requireUserSession(sessionToken);
          const [mine] = await db
            .select({ score: schema.ratings.score })
            .from(schema.ratings)
            .where(
              and(eq(schema.ratings.userId, userId), eq(schema.ratings.eventId, eventId)),
            )
            .limit(1);
          hasRated = Boolean(mine);
          myScore = mine?.score ?? null;
          const [checkIn] = await db
            .select({ id: schema.checkIns.id })
            .from(schema.checkIns)
            .where(
              and(eq(schema.checkIns.userId, userId), eq(schema.checkIns.eventId, eventId)),
            )
            .limit(1);
          can = canRate({
            hasCheckIn: Boolean(checkIn),
            alreadyRated: hasRated,
            isOwnEvent: false,
            eventEndsAt: event.endsAt,
            now: now(),
          });
        } catch (err) {
          if (!(err instanceof AuthError)) throw err;
        }
      }
      return {
        canRate: can,
        hasRated,
        opensAt: opensAt.toISOString(),
        closesAt: closesAt.toISOString(),
        myScore,
        aggregate: agg,
      };
    },

    async create(sessionToken, eventId, input: CreateRatingRequest) {
      let userId: string;
      try {
        ({ userId } = await auth.requireUserSession(sessionToken));
      } catch (err) {
        if (err instanceof AuthError) throw new RatingError('unauthorized');
        throw err;
      }
      const event = await loadPublished(eventId);
      const [checkIn] = await db
        .select({ id: schema.checkIns.id })
        .from(schema.checkIns)
        .where(
          and(eq(schema.checkIns.userId, userId), eq(schema.checkIns.eventId, eventId)),
        )
        .limit(1);
      const [existing] = await db
        .select({ id: schema.ratings.id })
        .from(schema.ratings)
        .where(
          and(eq(schema.ratings.userId, userId), eq(schema.ratings.eventId, eventId)),
        )
        .limit(1);
      if (
        !canRate({
          hasCheckIn: Boolean(checkIn),
          alreadyRated: Boolean(existing),
          isOwnEvent: false,
          eventEndsAt: event.endsAt,
          now: now(),
        })
      ) {
        throw new RatingError(existing ? 'already_rated' : 'not_eligible');
      }

      const [user] = await db
        .select({
          displayName: schema.users.displayName,
          isPublic: schema.users.isPublic,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      let comment: string | null = null;
      if (input.comment != null && input.comment.trim() !== '') {
        if (!user || !canComment(user)) throw new RatingError('comment_not_allowed');
        comment = input.comment.trim();
      }

      const createdAt = now();
      let inserted: {
        id: string;
        userId: string;
        eventId: string;
        score: number;
        createdAt: Date;
      } | undefined;
      try {
        const rows = await db
          .insert(schema.ratings)
          .values({
            userId,
            eventId,
            score: input.score,
            comment,
            createdAt,
          })
          .returning({
            id: schema.ratings.id,
            userId: schema.ratings.userId,
            eventId: schema.ratings.eventId,
            score: schema.ratings.score,
            createdAt: schema.ratings.createdAt,
          });
        inserted = rows[0];
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === '23505') throw new RatingError('already_rated');
        throw err;
      }
      if (!inserted) throw new RatingError('already_rated');

      await enqueueDomainEvent(domainEvents, {
        type: 'rating.created',
        eventId,
        userId,
        score: inserted.score,
      });

      return {
        id: inserted.id,
        eventId: inserted.eventId,
        userId: inserted.userId,
        score: inserted.score,
        comment: null,
        createdAt: inserted.createdAt.toISOString(),
      } satisfies Rating;
    },

    async listManaged(publisherSessionToken, eventId) {
      const [event] = await db
        .select({
          id: schema.events.id,
          publisherId: schema.events.publisherId,
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);
      if (!event) throw new RatingError('not_found');
      try {
        await auth.requirePublisherMember(
          publisherSessionToken,
          requirePublisherId(event.publisherId),
        );
      } catch (err) {
        if (err instanceof AuthError) {
          throw new RatingError(err.code === 'forbidden' ? 'forbidden' : 'unauthorized');
        }
        throw err;
      }
      const rows = await db
        .select({
          id: schema.ratings.id,
          eventId: schema.ratings.eventId,
          userId: schema.ratings.userId,
          score: schema.ratings.score,
          comment: schema.ratings.comment,
          createdAt: schema.ratings.createdAt,
          displayName: schema.users.displayName,
        })
        .from(schema.ratings)
        .leftJoin(schema.users, eq(schema.users.id, schema.ratings.userId))
        .where(and(eq(schema.ratings.eventId, eventId), isNull(schema.ratings.hiddenAt)));
      return {
        items: rows.map((r) => ({
          id: r.id,
          eventId: r.eventId,
          userId: r.userId,
          score: r.score,
          comment: r.comment,
          displayName: r.displayName ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        aggregate: await loadAggregate(eventId),
      };
    },
  };
}

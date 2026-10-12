import type { CreateRatingRequest, Rating } from '@local-events/contracts';
import {
  canComment,
  canRate,
  RATING_WINDOW_DAYS,
} from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent } from '../domain-events/types';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { RatingError, type RatingEnv, type RatingServices } from './types';

function aggregate(scores: number[]) {
  if (scores.length === 0) return { average: null as number | null, count: 0 };
  const sum = scores.reduce((a, b) => a + b, 0);
  return { average: Math.round((sum / scores.length) * 10) / 10, count: scores.length };
}

export function createMemoryRatingServices(
  auth: AuthServices,
  env: RatingEnv = {},
  store: MemoryStore = createMemoryStore(),
): RatingServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();

  return {
    async getStatus(sessionToken, eventId) {
      const event = store.events.get(eventId);
      if (!event || event.status !== 'published') throw new RatingError('not_found');
      const opensAt = event.endsAtDate;
      const closesAt = new Date(opensAt.getTime() + RATING_WINDOW_DAYS * 86_400_000);
      const eventScores = store.ratings.filter(
        (r) => r.eventId === eventId && !r.hiddenAt,
      );
      const agg = aggregate(eventScores.map((r) => r.score));

      let hasRated = false;
      let myScore: number | null = null;
      let can = false;
      if (sessionToken) {
        try {
          const { userId } = await auth.requireUserSession(sessionToken);
          const mine = eventScores.find((r) => r.userId === userId);
          hasRated = Boolean(mine);
          myScore = mine?.score ?? null;
          const hasCheckIn = store.checkIns.some(
            (c) => c.userId === userId && c.eventId === eventId,
          );
          can = canRate({
            hasCheckIn,
            alreadyRated: hasRated,
            isOwnEvent: false,
            eventEndsAt: event.endsAtDate,
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
      const event = store.events.get(eventId);
      if (!event || event.status !== 'published') throw new RatingError('not_found');
      const hasCheckIn = store.checkIns.some(
        (c) => c.userId === userId && c.eventId === eventId,
      );
      const alreadyRated = store.ratings.some(
        (r) => r.userId === userId && r.eventId === eventId,
      );
      if (
        !canRate({
          hasCheckIn,
          alreadyRated,
          isOwnEvent: false,
          eventEndsAt: event.endsAtDate,
          now: now(),
        })
      ) {
        throw new RatingError(alreadyRated ? 'already_rated' : 'not_eligible');
      }

      const user = store.users.get(userId);
      let comment: string | null = null;
      if (input.comment != null && input.comment.trim() !== '') {
        if (
          !user ||
          !canComment({ displayName: user.displayName, isPublic: user.isPublic })
        ) {
          throw new RatingError('comment_not_allowed');
        }
        comment = input.comment.trim();
      }

      const createdAt = now();
      const row = {
        id: randomUUID(),
        userId,
        eventId,
        score: input.score,
        comment,
        createdAt,
        hiddenAt: null as Date | null,
      };
      store.ratings.push(row);
      await enqueueDomainEvent(domainEvents, {
        type: 'rating.created',
        eventId,
        userId,
        score: row.score,
      });
      return {
        id: row.id,
        eventId,
        userId,
        score: row.score,
        comment: null,
        createdAt: createdAt.toISOString(),
      } satisfies Rating;
    },

    async listManaged(publisherSessionToken, eventId) {
      const event = store.events.get(eventId);
      if (!event) throw new RatingError('not_found');
      try {
        await auth.requirePublisherMember(publisherSessionToken, event.publisherId);
      } catch (err) {
        if (err instanceof AuthError) {
          throw new RatingError(err.code === 'forbidden' ? 'forbidden' : 'unauthorized');
        }
        throw err;
      }
      const rows = store.ratings.filter((r) => r.eventId === eventId && !r.hiddenAt);
      return {
        items: rows.map((r) => {
          const user = store.users.get(r.userId);
          return {
            id: r.id,
            eventId: r.eventId,
            userId: r.userId,
            score: r.score,
            comment: r.comment,
            displayName: user?.displayName ?? null,
            createdAt: r.createdAt.toISOString(),
          };
        }),
        aggregate: aggregate(rows.map((r) => r.score)),
      };
    },
  };
}

import type {
  AdminBanUserRequest,
  AdminRatingModerationListResponse,
  AdminSuspiciousCheckInListResponse,
  AdminUserListResponse,
  AdminUserSummary,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { and, desc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { AdminAuditServices } from './audit';
import { noopAudit } from './audit';

export type AdminModerationServices = {
  listUsers: () => Promise<AdminUserListResponse['items']>;
  banUser: (
    userId: string,
    body: AdminBanUserRequest,
    actor: string,
  ) => Promise<AdminUserSummary | null>;
  unbanUser: (userId: string, actor: string) => Promise<AdminUserSummary | null>;
  listRatings: () => Promise<AdminRatingModerationListResponse['items']>;
  hideRating: (ratingId: string, actor: string) => Promise<{ id: string } | null>;
  listSuspiciousCheckIns: () => Promise<AdminSuspiciousCheckInListResponse['items']>;
};

export type AdminModerationEnv = {
  now?: () => Date;
  audit?: AdminAuditServices;
};

function mapUser(r: {
  id: string;
  displayName: string | null;
  recoveryEmail: string | null;
  isPublic: boolean;
  bannedAt: Date | null;
  banReason: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
}): AdminUserSummary {
  return {
    id: r.id,
    displayName: r.displayName,
    recoveryEmail: r.recoveryEmail,
    isPublic: r.isPublic,
    bannedAt: r.bannedAt?.toISOString() ?? null,
    banReason: r.banReason,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
  };
}

export function createMemoryAdminModerationServices(
  store: {
    users: Map<
      string,
      {
        id: string;
        displayName: string | null;
        recoveryEmail: string | null;
        isPublic: boolean;
        bannedAt: string | null;
        banReason: string | null;
        createdAt: string;
        lastSeenAt: string | null;
      }
    >;
    ratings: Map<
      string,
      {
        id: string;
        userId: string;
        eventId: string;
        eventTitle: string;
        score: number;
        comment: string | null;
        hiddenAt: string | null;
        createdAt: string;
      }
    >;
    checkIns: Map<
      string,
      {
        id: string;
        userId: string;
        eventId: string;
        eventTitle: string;
        method: 'geo' | 'code';
        accuracyM: number | null;
        deviceFlags: Record<string, unknown>;
        createdAt: string;
      }
    >;
  },
  env: AdminModerationEnv = {},
): AdminModerationServices {
  const now = env.now ?? (() => new Date());
  const audit = env.audit ?? noopAudit;
  return {
    async listUsers() {
      return [...store.users.values()];
    },
    async banUser(userId, body, actor) {
      const u = store.users.get(userId);
      if (!u) return null;
      const before = { ...u };
      u.bannedAt = now().toISOString();
      u.banReason = body.reason;
      await audit.write({
        actor,
        action: 'user.ban',
        entityType: 'user',
        entityId: userId,
        before,
        after: { ...u },
      });
      return u;
    },
    async unbanUser(userId, actor) {
      const u = store.users.get(userId);
      if (!u) return null;
      const before = { ...u };
      u.bannedAt = null;
      u.banReason = null;
      await audit.write({
        actor,
        action: 'user.unban',
        entityType: 'user',
        entityId: userId,
        before,
        after: { ...u },
      });
      return u;
    },
    async listRatings() {
      return [...store.ratings.values()].filter((r) => r.comment);
    },
    async hideRating(ratingId, actor) {
      const r = store.ratings.get(ratingId);
      if (!r) return null;
      const before = { ...r };
      r.hiddenAt = now().toISOString();
      await audit.write({
        actor,
        action: 'rating.hide',
        entityType: 'rating',
        entityId: ratingId,
        before,
        after: { ...r },
      });
      return { id: ratingId };
    },
    async listSuspiciousCheckIns() {
      return [...store.checkIns.values()].filter(
        (c) =>
          (c.accuracyM != null && c.accuracyM > 200) ||
          Object.keys(c.deviceFlags).length > 0,
      );
    },
  };
}

export function createDbAdminModerationServices(
  db: Db,
  env: AdminModerationEnv = {},
): AdminModerationServices {
  const now = env.now ?? (() => new Date());
  const audit = env.audit ?? noopAudit;
  return {
    async listUsers() {
      const rows = await db
        .select({
          id: schema.users.id,
          displayName: schema.users.displayName,
          recoveryEmail: schema.users.recoveryEmail,
          isPublic: schema.users.isPublic,
          bannedAt: schema.users.bannedAt,
          banReason: schema.users.banReason,
          createdAt: schema.users.createdAt,
          lastSeenAt: schema.users.lastSeenAt,
        })
        .from(schema.users)
        .orderBy(desc(schema.users.createdAt))
        .limit(200);
      return rows.map(mapUser);
    },
    async banUser(userId, body, actor) {
      const [existing] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!existing) return null;
      const at = now();
      const [updated] = await db
        .update(schema.users)
        .set({ bannedAt: at, banReason: body.reason })
        .where(eq(schema.users.id, userId))
        .returning();
      if (!updated) return null;
      await db
        .update(schema.sessions)
        .set({ revokedAt: at })
        .where(
          and(
            eq(schema.sessions.subjectType, 'user'),
            eq(schema.sessions.subjectId, userId),
            isNull(schema.sessions.revokedAt),
          ),
        );
      await db
        .update(schema.devices)
        .set({ revokedAt: at, expoPushToken: null })
        .where(and(eq(schema.devices.userId, userId), isNull(schema.devices.revokedAt)));
      await audit.write({
        actor,
        action: 'user.ban',
        entityType: 'user',
        entityId: userId,
        before: { bannedAt: existing.bannedAt, banReason: existing.banReason },
        after: { bannedAt: updated.bannedAt, banReason: updated.banReason },
      });
      return mapUser(updated);
    },
    async unbanUser(userId, actor) {
      const [existing] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!existing) return null;
      const [updated] = await db
        .update(schema.users)
        .set({ bannedAt: null, banReason: null })
        .where(eq(schema.users.id, userId))
        .returning();
      if (!updated) return null;
      await audit.write({
        actor,
        action: 'user.unban',
        entityType: 'user',
        entityId: userId,
        before: { bannedAt: existing.bannedAt, banReason: existing.banReason },
        after: { bannedAt: null, banReason: null },
      });
      return mapUser(updated);
    },
    async listRatings() {
      const rows = await db
        .select({
          id: schema.ratings.id,
          userId: schema.ratings.userId,
          eventId: schema.ratings.eventId,
          eventTitle: schema.events.title,
          score: schema.ratings.score,
          comment: schema.ratings.comment,
          hiddenAt: schema.ratings.hiddenAt,
          createdAt: schema.ratings.createdAt,
        })
        .from(schema.ratings)
        .innerJoin(schema.events, eq(schema.ratings.eventId, schema.events.id))
        .where(and(isNotNull(schema.ratings.comment), isNull(schema.ratings.hiddenAt)))
        .orderBy(desc(schema.ratings.createdAt))
        .limit(100);
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        eventId: r.eventId,
        eventTitle: r.eventTitle,
        score: r.score,
        comment: r.comment,
        hiddenAt: r.hiddenAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    },
    async hideRating(ratingId, actor) {
      const [existing] = await db
        .select({ id: schema.ratings.id, hiddenAt: schema.ratings.hiddenAt })
        .from(schema.ratings)
        .where(eq(schema.ratings.id, ratingId))
        .limit(1);
      if (!existing) return null;
      const at = now();
      await db
        .update(schema.ratings)
        .set({ hiddenAt: at })
        .where(eq(schema.ratings.id, ratingId));
      await audit.write({
        actor,
        action: 'rating.hide',
        entityType: 'rating',
        entityId: ratingId,
        before: { hiddenAt: existing.hiddenAt },
        after: { hiddenAt: at },
      });
      return { id: ratingId };
    },
    async listSuspiciousCheckIns() {
      const rows = await db
        .select({
          id: schema.checkIns.id,
          userId: schema.checkIns.userId,
          eventId: schema.checkIns.eventId,
          eventTitle: schema.events.title,
          method: schema.checkIns.method,
          accuracyM: schema.checkIns.accuracyM,
          deviceFlags: schema.checkIns.deviceFlags,
          createdAt: schema.checkIns.createdAt,
        })
        .from(schema.checkIns)
        .innerJoin(schema.events, eq(schema.checkIns.eventId, schema.events.id))
        .where(
          or(
            gt(schema.checkIns.accuracyM, 200),
            sql`${schema.checkIns.deviceFlags} <> '{}'::jsonb`,
          ),
        )
        .orderBy(desc(schema.checkIns.createdAt))
        .limit(100);
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        eventId: r.eventId,
        eventTitle: r.eventTitle,
        method: r.method,
        accuracyM: r.accuracyM,
        deviceFlags: (r.deviceFlags as Record<string, unknown>) ?? {},
        createdAt: r.createdAt.toISOString(),
      }));
    },
  };
}

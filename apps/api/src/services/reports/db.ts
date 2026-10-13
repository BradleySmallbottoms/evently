import type { EventReport } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { canReportEvent } from '@local-events/domain';
import { and, eq } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { ReportError, type ReportCreateResult, type ReportServices } from './types';

export function createDbReportServices(
  db: Db,
  auth: AuthServices,
  env: { now?: () => Date } = {},
): ReportServices {
  const now = env.now ?? (() => new Date());

  function toReport(row: { id: string; eventId: string; createdAt: Date }): EventReport {
    return {
      id: row.id,
      eventId: row.eventId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  return {
    async create(sessionToken, eventId): Promise<ReportCreateResult> {
      let userId: string;
      try {
        ({ userId } = await auth.requireUserSession(sessionToken));
      } catch (err) {
        if (err instanceof AuthError && err.code === 'user_banned') {
          throw new ReportError('forbidden');
        }
        if (err instanceof AuthError) throw new ReportError('unauthorized');
        throw err;
      }
      const [event] = await db
        .select({ status: schema.events.status })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);
      if (!event || !canReportEvent(event.status)) throw new ReportError('not_found');

      const inserted = await db
        .insert(schema.eventReports)
        .values({ userId, eventId, createdAt: now() })
        .onConflictDoNothing({
          target: [schema.eventReports.userId, schema.eventReports.eventId],
        })
        .returning({
          id: schema.eventReports.id,
          eventId: schema.eventReports.eventId,
          createdAt: schema.eventReports.createdAt,
        });
      const created = inserted[0];
      if (created) return { report: toReport(created), created: true };

      const [existing] = await db
        .select({
          id: schema.eventReports.id,
          eventId: schema.eventReports.eventId,
          createdAt: schema.eventReports.createdAt,
        })
        .from(schema.eventReports)
        .where(
          and(eq(schema.eventReports.userId, userId), eq(schema.eventReports.eventId, eventId)),
        )
        .limit(1);
      if (!existing) throw new ReportError('not_found');
      return { report: toReport(existing), created: false };
    },
  };
}

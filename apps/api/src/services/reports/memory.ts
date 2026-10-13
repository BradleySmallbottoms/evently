import type { EventReport } from '@local-events/contracts';
import { canReportEvent } from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryStore, type MemoryEventReport, type MemoryStore } from '../memory-store';
import { ReportError, type ReportCreateResult, type ReportServices } from './types';

export function createMemoryReportServices(
  auth: AuthServices,
  store: MemoryStore = createMemoryStore(),
  env: { now?: () => Date } = {},
): ReportServices {
  const now = env.now ?? (() => new Date());

  function toReport(row: MemoryEventReport): EventReport {
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
      const event = store.events.get(eventId);
      if (!event || !canReportEvent(event.status)) throw new ReportError('not_found');
      const existing = store.eventReports.find(
        (row) => row.userId === userId && row.eventId === eventId,
      );
      if (existing) return { report: toReport(existing), created: false };
      const row: MemoryEventReport = {
        id: randomUUID(),
        userId,
        eventId,
        createdAt: now(),
      };
      store.eventReports.push(row);
      return { report: toReport(row), created: true };
    },
  };
}

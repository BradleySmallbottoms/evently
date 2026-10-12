import type { AdminAuditLogListResponse } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { desc } from 'drizzle-orm';

export type AuditWrite = {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  at?: Date;
};

export type AdminAuditServices = {
  list: (limit?: number) => Promise<AdminAuditLogListResponse['items']>;
  write: (entry: AuditWrite) => Promise<void>;
};

export type AdminAuditMemoryStore = {
  entries: Array<AdminAuditLogListResponse['items'][number] & { sortAt: number }>;
};

export function createMemoryAdminAuditServices(
  store: AdminAuditMemoryStore = { entries: [] },
): AdminAuditServices {
  return {
    async list(limit = 100) {
      return store.entries
        .slice()
        .sort((a, b) => b.sortAt - a.sortAt)
        .slice(0, limit)
        .map(({ sortAt: _s, ...row }) => row);
    },
    async write(entry) {
      const at = entry.at ?? new Date();
      store.entries.push({
        id: crypto.randomUUID(),
        actor: entry.actor,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before ?? null,
        after: entry.after ?? null,
        at: at.toISOString(),
        sortAt: at.getTime(),
      });
    },
  };
}

export function createDbAdminAuditServices(db: Db): AdminAuditServices {
  return {
    async list(limit = 100) {
      const rows = await db
        .select({
          id: schema.auditLog.id,
          actor: schema.auditLog.actor,
          action: schema.auditLog.action,
          entityType: schema.auditLog.entityType,
          entityId: schema.auditLog.entityId,
          before: schema.auditLog.before,
          after: schema.auditLog.after,
          at: schema.auditLog.at,
        })
        .from(schema.auditLog)
        .orderBy(desc(schema.auditLog.at))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: (r.before as Record<string, unknown> | null) ?? null,
        after: (r.after as Record<string, unknown> | null) ?? null,
        at: r.at.toISOString(),
      }));
    },
    async write(entry) {
      await db.insert(schema.auditLog).values({
        actor: entry.actor,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before ?? null,
        after: entry.after ?? null,
        at: entry.at ?? new Date(),
      });
    },
  };
}

export const noopAudit: AdminAuditServices = {
  async list() {
    return [];
  },
  async write() {},
};

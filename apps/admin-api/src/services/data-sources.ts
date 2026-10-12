import type {
  AdminDataSourceListResponse,
  AdminDataSourcePatchRequest,
  AdminDataSourceRunResponse,
  AdminIngestionRunListResponse,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { desc, eq } from 'drizzle-orm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type AdminDataSourceServices = {
  list: () => Promise<AdminDataSourceListResponse['items']>;
  patch: (
    id: string,
    body: AdminDataSourcePatchRequest,
  ) => Promise<AdminDataSourceListResponse['items'][number] | null>;
  listRuns: (sourceId: string) => Promise<AdminIngestionRunListResponse['items']>;
  triggerRun: (id: string) => Promise<AdminDataSourceRunResponse | null>;
};

export type AdminDataSourceMemoryStore = {
  sources: Map<
    string,
    {
      id: string;
      slug: string;
      kind: 'api' | 'feed' | 'scraper';
      schedule: string;
      trust: 'auto_publish' | 'review';
      enabled: boolean;
      createdAt: string;
    }
  >;
  runs: Map<
    string,
    {
      id: string;
      sourceId: string;
      startedAt: string;
      finishedAt: string | null;
      status: string;
      fetched: number;
      created: number;
      updated: number;
      skipped: number;
      error: string | null;
    }
  >;
};

/** `services/data-sources.ts` → src → admin-api → apps → repo root. */
export function ingestRepoRoot(moduleUrl: string = import.meta.url): string {
  return path.resolve(fileURLToPath(new URL('.', moduleUrl)), '../../../..');
}

export function createMemoryAdminDataSourceServices(
  store: AdminDataSourceMemoryStore,
): AdminDataSourceServices {
  return {
    async list() {
      return [...store.sources.values()];
    },
    async patch(id, body) {
      const row = store.sources.get(id);
      if (!row) return null;
      if (body.enabled !== undefined) row.enabled = body.enabled;
      return row;
    },
    async listRuns(sourceId) {
      return [...store.runs.values()]
        .filter((r) => r.sourceId === sourceId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    async triggerRun(id) {
      const row = store.sources.get(id);
      if (!row) return null;
      return {
        started: false,
        mode: 'unavailable' as const,
        message: `Run locally: pnpm --filter @local-events/data-workers dev -- --source ${row.slug}`,
      };
    },
  };
}

export function createDbAdminDataSourceServices(db: Db): AdminDataSourceServices {
  return {
    async list() {
      const rows = await db
        .select({
          id: schema.dataSources.id,
          slug: schema.dataSources.slug,
          kind: schema.dataSources.kind,
          schedule: schema.dataSources.schedule,
          trust: schema.dataSources.trust,
          enabled: schema.dataSources.enabled,
          createdAt: schema.dataSources.createdAt,
        })
        .from(schema.dataSources)
        .orderBy(schema.dataSources.slug);
      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }));
    },
    async patch(id, body) {
      if (body.enabled === undefined) {
        const [existing] = await db
          .select({
            id: schema.dataSources.id,
            slug: schema.dataSources.slug,
            kind: schema.dataSources.kind,
            schedule: schema.dataSources.schedule,
            trust: schema.dataSources.trust,
            enabled: schema.dataSources.enabled,
            createdAt: schema.dataSources.createdAt,
          })
          .from(schema.dataSources)
          .where(eq(schema.dataSources.id, id))
          .limit(1);
        return existing ? { ...existing, createdAt: existing.createdAt.toISOString() } : null;
      }
      const [updated] = await db
        .update(schema.dataSources)
        .set({ enabled: body.enabled })
        .where(eq(schema.dataSources.id, id))
        .returning({
          id: schema.dataSources.id,
          slug: schema.dataSources.slug,
          kind: schema.dataSources.kind,
          schedule: schema.dataSources.schedule,
          trust: schema.dataSources.trust,
          enabled: schema.dataSources.enabled,
          createdAt: schema.dataSources.createdAt,
        });
      return updated ? { ...updated, createdAt: updated.createdAt.toISOString() } : null;
    },
    async listRuns(sourceId) {
      const rows = await db
        .select({
          id: schema.ingestionRuns.id,
          sourceId: schema.ingestionRuns.sourceId,
          startedAt: schema.ingestionRuns.startedAt,
          finishedAt: schema.ingestionRuns.finishedAt,
          status: schema.ingestionRuns.status,
          fetched: schema.ingestionRuns.fetched,
          created: schema.ingestionRuns.created,
          updated: schema.ingestionRuns.updated,
          skipped: schema.ingestionRuns.skipped,
          error: schema.ingestionRuns.error,
        })
        .from(schema.ingestionRuns)
        .where(eq(schema.ingestionRuns.sourceId, sourceId))
        .orderBy(desc(schema.ingestionRuns.startedAt))
        .limit(50);
      return rows.map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        status: r.status,
        fetched: r.fetched,
        created: r.created,
        updated: r.updated,
        skipped: r.skipped,
        error: r.error,
      }));
    },
    async triggerRun(id) {
      const [row] = await db
        .select({ id: schema.dataSources.id, slug: schema.dataSources.slug })
        .from(schema.dataSources)
        .where(eq(schema.dataSources.id, id))
        .limit(1);
      if (!row) return null;

      const mode = process.env.INGEST_RUN_MODE?.trim() ?? 'local_spawn';
      if (mode === 'local_spawn') {
        const child = spawn(
          'pnpm',
          ['--filter', '@local-events/data-workers', 'dev', '--', '--source', row.slug],
          {
            cwd: ingestRepoRoot(),
            detached: true,
            stdio: 'ignore',
            env: process.env,
          },
        );
        child.unref();
        return {
          started: true,
          mode: 'local_spawn' as const,
          message: `Started local ingest for ${row.slug}`,
        };
      }

      return {
        started: false,
        mode: 'unavailable' as const,
        message: `Configure INGEST_RUN_MODE=local_spawn or run: pnpm --filter @local-events/data-workers dev -- --source ${row.slug}`,
      };
    },
  };
}

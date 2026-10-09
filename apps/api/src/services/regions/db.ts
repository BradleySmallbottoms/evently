import type { Db } from '@local-events/db';
import { pointEwkt, schema } from '@local-events/db';
import { sql } from 'drizzle-orm';
import type { RegionServices } from './types';

export function createDbRegionServices(db: Db): RegionServices {
  const { regions } = schema;

  return {
    async lookup(query) {
      const point = pointEwkt({ lat: query.lat, lng: query.lng });
      const rows = await db
        .select({
          id: regions.id,
          name: regions.name,
          kind: regions.kind,
          code: regions.code,
        })
        .from(regions)
        .where(sql`ST_Covers(${regions.boundary}, ${point}::geography)`)
        .orderBy(sql`CASE WHEN ${regions.kind} = 'municipality' THEN 0 ELSE 1 END`)
        .limit(1);
      const region = rows[0] ?? null;
      return { region };
    },
  };
}

import { type Db } from '@local-events/db';
import { sql } from 'drizzle-orm';

export interface RewindScanSummary {
  events: number;
  occasions: number;
}

/**
 * Puts imported events back to the pre-scan status and clears scan-written
 * places, while leaving `llm_output` in place. A point stored on the imported
 * address is copied back onto the showing. Publisher, tags, and the venue
 * table stay.
 */
export async function rewindImportedScans(db: Db, eventId?: string): Promise<RewindScanSummary> {
  const eventSql = eventId ? sql`and e.id = ${eventId}::uuid` : sql``;
  const occasions = await db.execute<{ id: string }>(sql`
    update event_occasions o
    set venue_id = null,
        location = case
          when jsonb_typeof(e.meta->'address'->'location') = 'object'
           and (e.meta->'address'->'location'->>'lat') ~ '^-?[0-9]+(\\.[0-9]+)?$'
           and (e.meta->'address'->'location'->>'lng') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          then ST_SetSRID(
            ST_MakePoint(
              (e.meta->'address'->'location'->>'lng')::double precision,
              (e.meta->'address'->'location'->>'lat')::double precision
            ),
            4326
          )::geography
          else null
        end,
        updated_at = now()
    from events e
    where o.event_id = e.id
      and e.origin = 'imported'
      and e.llm_output is not null
      and e.status in ('pending_scan', 'in_review', 'published')
      ${eventSql}
    returning o.id
  `);
  const updated = await db.execute<{ id: string }>(sql`
    update events e
    set status = 'pending_scan',
        summary = null,
        content_verdict = 'unknown',
        scan_claimed_until = null,
        updated_at = now()
    where e.origin = 'imported'
      and e.llm_output is not null
      and e.status in ('pending_scan', 'in_review', 'published')
      ${eventSql}
    returning e.id
  `);
  return { events: rowsOf(updated).length, occasions: rowsOf(occasions).length };
}

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

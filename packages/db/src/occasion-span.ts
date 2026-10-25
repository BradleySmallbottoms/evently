import { sql, type SQL } from 'drizzle-orm';

/**
 * Drizzle asks the driver for raw text, then maps known columns itself.
 * A hand-written subquery stays text unless it has its own mapper.
 */
const instant = {
  mapFromDriverValue(value: unknown): Date | null {
    if (value == null) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' && value.length > 0) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  },
};

/**
 * Earliest start of the outer `events` row.
 * Pass `after` to keep only occasions that start later than that instant.
 *
 * Names are written out. A Drizzle column inside `sql` drops its table when the
 * outer query reads only `events`, so `"event_id" = "id"` compares an occasion
 * to itself and the span comes back empty.
 */
export function occasionStartsAtSql(after?: Date): SQL<Date | null> {
  if (after) {
    return sql`(
      select min(eo.starts_at)
      from event_occasions eo
      where eo.event_id = events.id
        and eo.starts_at > ${after}
    )`.mapWith(instant);
  }
  return sql`(
    select min(eo.starts_at)
    from event_occasions eo
    where eo.event_id = events.id
  )`.mapWith(instant);
}

/** Latest end of the outer `events` row. See {@link occasionStartsAtSql}. */
export function occasionEndsAtSql(): SQL<Date | null> {
  return sql`(
    select max(eo.ends_at)
    from event_occasions eo
    where eo.event_id = events.id
  )`.mapWith(instant);
}

/** Venue of the earliest occasion of the outer `events` row. See {@link occasionStartsAtSql}. */
export function occasionVenueNameSql(): SQL<string | null> {
  return sql<string | null>`(
    select eo.venue_name
    from event_occasions eo
    where eo.event_id = events.id
    order by eo.starts_at asc
    limit 1
  )`;
}

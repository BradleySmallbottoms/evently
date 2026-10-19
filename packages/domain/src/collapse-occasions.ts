export type CollapseOccasion = {
  startsAt: string;
  endsAt?: string;
  venueName?: string;
  location?: { lat: number; lng: number };
};

/** One event that can be folded into a span. Existing occasion rows win over the event columns. */
export type CollapseMember = {
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  location: { lat: number; lng: number } | null;
  occasions?: CollapseOccasion[];
};

export type CollapseSpan = {
  startsAt: string;
  endsAt: string;
  occasions: CollapseOccasion[];
};

function instant(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

function fromColumns(member: CollapseMember): CollapseOccasion | null {
  if (Number.isNaN(instant(member.startsAt)) || Number.isNaN(instant(member.endsAt))) return null;
  return {
    startsAt: member.startsAt,
    endsAt: member.endsAt,
    ...(member.venueName ? { venueName: member.venueName } : {}),
    ...(member.location ? { location: member.location } : {}),
  };
}

function rowsOf(member: CollapseMember): CollapseOccasion[] | null {
  if (member.occasions && member.occasions.length > 0) {
    const rows: CollapseOccasion[] = [];
    for (const occasion of member.occasions) {
      if (Number.isNaN(instant(occasion.startsAt))) return null;
      if (occasion.endsAt && Number.isNaN(instant(occasion.endsAt))) return null;
      rows.push({
        startsAt: occasion.startsAt,
        ...(occasion.endsAt ? { endsAt: occasion.endsAt } : {}),
        ...(occasion.venueName ? { venueName: occasion.venueName } : {}),
        ...(occasion.location ? { location: occasion.location } : {}),
      });
    }
    return rows;
  }
  const row = fromColumns(member);
  return row ? [row] : null;
}

/**
 * Folds the host and the other events into one span.
 * The host's stored occasions are kept when it already has them; otherwise its own times are one row.
 * `startsAt` is the earliest start. `endsAt` is the latest end.
 * Returns null when nothing was selected or a time is not a real instant.
 */
export function collapseOccasionSpan(
  host: CollapseMember,
  members: readonly CollapseMember[],
): CollapseSpan | null {
  if (members.length === 0) return null;
  const collected: CollapseOccasion[] = [];
  for (const member of [host, ...members]) {
    const rows = rowsOf(member);
    if (!rows) return null;
    collected.push(...rows);
  }
  if (collected.length < 2) return null;
  const occasions = collected.sort((a, b) => {
    const byStart = instant(a.startsAt) - instant(b.startsAt);
    if (byStart !== 0) return byStart;
    return instant(a.endsAt ?? a.startsAt) - instant(b.endsAt ?? b.startsAt);
  });
  const startsAt = occasions[0]!.startsAt;
  let endsAt = occasions[0]!.endsAt ?? occasions[0]!.startsAt;
  for (const occasion of occasions) {
    const end = occasion.endsAt ?? occasion.startsAt;
    if (instant(end) > instant(endsAt)) endsAt = end;
  }
  if (instant(endsAt) < instant(startsAt)) return null;
  return { startsAt, endsAt, occasions };
}

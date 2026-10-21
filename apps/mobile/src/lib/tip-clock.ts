const STOCKHOLM = 'Europe/Stockholm';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function stockholmWhen(instant: Date): { day: string; clock: string } | null {
  const bag: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: STOCKHOLM,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  const hour = bag.hour === '24' ? '00' : bag.hour;
  if (!bag.year || !bag.month || !bag.day || !hour || !bag.minute) return null;
  return { day: `${bag.year}-${bag.month}-${bag.day}`, clock: `${hour}:${bag.minute}` };
}

/** Calendar day already found on a tip value, as `YYYY-MM-DD`. */
export function foundTipDay(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  if (!raw.includes('T')) return null;
  if (!/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw)) {
    const wall = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    return wall ? `${wall[1]}-${wall[2]}-${wall[3]}` : null;
  }
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return null;
  return stockholmWhen(instant)?.day ?? null;
}

/** Clock already found on a tip value, as `HH:MM`. A date with no clock stays empty. */
export function foundTipClock(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const bare = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (bare) return `${bare[1]}:${bare[2]}`;
  if (!raw.includes('T')) return null;
  if (!/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw)) {
    const wall = raw.match(/T([01]\d|2[0-3]):([0-5]\d)/);
    return wall ? `${wall[1]}:${wall[2]}` : null;
  }
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return null;
  return stockholmWhen(instant)?.clock ?? null;
}

/** Nearest five-minute clock. An empty or unreadable value starts at 18:00. */
export function nearestTipClock(value: string | null | undefined): string {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return '18:00';
  const hour = Number(match[1]);
  const rounded = Math.round(Number(match[2]) / 5) * 5;
  if (rounded === 60) return `${pad((hour + 1) % 24)}:00`;
  return `${pad(hour)}:${pad(rounded)}`;
}

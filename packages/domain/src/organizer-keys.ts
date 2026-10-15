/**
 * Ordered organizer keys shared by every data worker.
 * Email, then an info-link website, then the organizer name.
 * The source slug is used only when nothing else identifies the organizer.
 */

const MAX_ORGANIZER_KEYS = 8;

/** Hosts that identify a network or a ticket shop, not the organizer. */
const SHARED_SKIP_HOSTS = [
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'images.citybreakcdn.com',
  'images.citybreak.com',
  'tickster.com',
  'nortic.se',
  'ticketco.events',
  'ticketmaster.com',
  'ticketmaster.se',
  'billetto.com',
  'billetto.se',
  'eventbrite.com',
  'eventbrite.se',
  'axs.com',
];

export interface OrganizerKeyInput {
  /** Stable id from the source, tried before the contact fields. */
  ids?: Array<string | null | undefined>;
  emails?: Array<string | null | undefined>;
  /** Info links only. Ticket links are not organizer keys. */
  infoUrls?: Array<string | null | undefined>;
  names?: Array<string | null | undefined>;
  /** Stripped from the end of a name when it is written as ", town". */
  town?: string | null;
  /** Source slug, used only when the other lists are empty. */
  fallback: string;
  /** Extra hosts to ignore, such as the source site itself. */
  skipHosts?: string[];
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function skippedHost(host: string, extra: Set<string>): boolean {
  const bare = bareHost(host);
  for (const skip of extra) {
    if (bare === skip || bare.endsWith(`.${skip}`)) return true;
  }
  return false;
}

function pushUnique(keys: string[], value: string | undefined): void {
  const key = value?.trim();
  if (!key || keys.includes(key)) return;
  keys.push(key);
}

function emailKey(value: string | null | undefined): string | undefined {
  const text = value?.trim().toLowerCase().replace(/^mailto:/, '');
  if (!text || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return undefined;
  return text;
}

function hostKey(value: string | null | undefined, extra: Set<string>): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const host = bareHost(new URL(value).hostname);
    if (!host || skippedHost(host, extra)) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

function nameKey(value: string | null | undefined, town: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const place =
    town && trimmed.toLocaleLowerCase('sv').endsWith(`, ${town.toLocaleLowerCase('sv')}`)
      ? trimmed.slice(0, trimmed.length - town.length - 2).trim()
      : trimmed;
  const key = place.toLocaleLowerCase('sv');
  if (!key || key.includes('@')) return undefined;
  return key;
}

/** Deduped keys, strongest first. At most eight. */
export function organizerKeys(input: OrganizerKeyInput): string[] {
  const extra = new Set(
    [...SHARED_SKIP_HOSTS, ...(input.skipHosts ?? [])].map((host) => bareHost(host)).filter(Boolean),
  );
  const town = input.town?.trim() || undefined;
  const keys: string[] = [];
  for (const id of input.ids ?? []) pushUnique(keys, id?.trim());
  for (const email of input.emails ?? []) pushUnique(keys, emailKey(email));
  for (const url of input.infoUrls ?? []) pushUnique(keys, hostKey(url, extra));
  for (const name of input.names ?? []) pushUnique(keys, nameKey(name, town));
  if (keys.length === 0) pushUnique(keys, input.fallback.trim());
  return keys.slice(0, MAX_ORGANIZER_KEYS);
}

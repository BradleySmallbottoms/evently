/**
 * Ordered organizer keys shared by every data worker.
 * Email, then an info-link host plus its path, then that host, then the organizer name.
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
  const text = value
    ?.trim()
    .toLowerCase()
    .replace(/^mailto:/, '');
  if (!text || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return undefined;
  return text;
}

/** Host, and `host/path` when the URL has a path. `www`, a trailing slash, and the query are dropped. */
function websiteKeys(value: string | null | undefined, extra: Set<string>): string[] {
  if (!value?.trim()) return [];
  try {
    const url = new URL(value);
    const host = bareHost(url.hostname);
    if (!host || skippedHost(host, extra)) return [];
    const path = websitePath(url.pathname);
    return path ? [`${host}${path}`, host] : [host];
  } catch {
    return [];
  }
}

function websitePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return '';
  try {
    return decodeURIComponent(trimmed).toLowerCase();
  } catch {
    return trimmed.toLowerCase();
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
    [...SHARED_SKIP_HOSTS, ...(input.skipHosts ?? [])]
      .map((host) => bareHost(host))
      .filter(Boolean),
  );
  const town = input.town?.trim() || undefined;
  const keys: string[] = [];
  for (const id of input.ids ?? []) pushUnique(keys, id?.trim());
  for (const email of input.emails ?? []) pushUnique(keys, emailKey(email));
  const paths: string[] = [];
  const hosts: string[] = [];
  for (const url of input.infoUrls ?? []) {
    for (const key of websiteKeys(url, extra)) {
      pushUnique(key.includes('/') ? paths : hosts, key);
    }
  }
  for (const key of paths) pushUnique(keys, key);
  for (const key of hosts) pushUnique(keys, key);
  for (const name of input.names ?? []) pushUnique(keys, nameKey(name, town));
  if (keys.length === 0) pushUnique(keys, input.fallback.trim());
  return keys.slice(0, MAX_ORGANIZER_KEYS);
}

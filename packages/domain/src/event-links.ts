import { MAX_EVENT_LINKS, type EventLinkKind } from './events';

export type ImportEventLink = {
  type: EventLinkKind;
  url: string;
  label?: string;
};

const ANCHOR = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
const MARKDOWN = /\[([^\]\n]{1,80})\]\((https?:\/\/[^)\s]+)\)/gi;
const BARE_URL = /https?:\/\/[^\s<>"']+/gi;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function linkKey(raw: string): string | null {
  let value = decodeEntities(raw).trim().replace(/[.,;:!?)]+$/, '');
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return null;
  }
}

function isImageUrl(key: string): boolean {
  return /\.(?:jpe?g|png|gif|webp|svg|avif)(?:$|\?)/i.test(key);
}

function kindFor(url: string, label?: string): EventLinkKind {
  const hay = `${label ?? ''} ${url}`.toLowerCase();
  if (/ticket|biljett|ticketco|tickster|nortic|bokning|booking/.test(hay)) return 'tickets';
  if (
    /anm[aä]lan|anmalan|signup|sign-up|registr|typeform|forms\.gle|docs\.google\.com\/forms/.test(
      hay,
    )
  ) {
    return 'registration';
  }
  return 'info';
}

function labelFrom(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = decodeEntities(raw.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || /^https?:\/\//i.test(text)) return undefined;
  return text.slice(0, 80);
}

function pushLink(
  links: ImportEventLink[],
  seen: Set<string>,
  rawUrl: string,
  label?: string,
): void {
  if (links.length >= MAX_EVENT_LINKS) return;
  const key = linkKey(rawUrl);
  if (!key || seen.has(key) || isImageUrl(key)) return;
  seen.add(key);
  const type = kindFor(key, label);
  links.push(label ? { type, url: key, label } : { type, url: key });
}

/** http(s) links in free text, HTML anchors, and markdown. Image files are skipped. */
export function parseLinksFromText(text: string): ImportEventLink[] {
  const links: ImportEventLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(ANCHOR)) {
    const href = match[1] ?? match[2] ?? match[3] ?? '';
    pushLink(links, seen, href, labelFrom(match[4]));
  }
  for (const match of text.matchAll(MARKDOWN)) {
    pushLink(links, seen, match[2] ?? '', labelFrom(match[1]));
  }
  for (const match of text.matchAll(BARE_URL)) {
    pushLink(links, seen, match[0] ?? '');
  }
  return links;
}

/**
 * Adapter links stay first (and keep their type). Links parsed from the description
 * fill the rest, up to the event link cap. The same page with or without a trailing
 * slash counts once.
 */
export function mergeImportedLinks(
  existing: ImportEventLink[] | undefined,
  description: string | undefined,
): ImportEventLink[] | undefined {
  const links: ImportEventLink[] = [];
  const seen = new Set<string>();
  for (const link of existing ?? []) {
    const key = linkKey(link.url);
    if (!key || seen.has(key)) continue;
    if (links.length >= MAX_EVENT_LINKS) break;
    seen.add(key);
    const label = labelFrom(link.label);
    links.push(label ? { type: link.type, url: link.url, label } : { type: link.type, url: link.url });
  }
  for (const link of parseLinksFromText(description ?? '')) {
    const key = linkKey(link.url);
    if (!key || seen.has(key)) continue;
    if (links.length >= MAX_EVENT_LINKS) break;
    seen.add(key);
    links.push(link);
  }
  if (links.length > 0) return links;
  return existing ? [] : undefined;
}

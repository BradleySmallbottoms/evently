import { load } from 'cheerio';
import type { SourceRunContext } from '@local-events/ingest';
import { isPublicHttpsImageUrl } from '../../event-images';

/** Og images first, then other page images, capped per product. */
const MAX_IMAGES = 8;
const MAX_PAGES = 250;
const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const CONCURRENCY = 4;
const MAX_URL_LENGTH = 2000;

const JUNK =
  /(?:^|[/?=_.-])(?:favicon|sprite|pixel|spacer|tracking|1x1|blank|emoji|spinner)(?:[/?=_.-]|$)/i;

export interface PageImages {
  og: string[];
  img: string[];
}

interface PageFetch {
  ok: boolean;
  og: string[];
  img: string[];
}

function pixelSize(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const size = Number.parseInt(value, 10);
  return Number.isFinite(size) ? size : undefined;
}

function isTiny(width: string | undefined, height: string | undefined): boolean {
  const w = pixelSize(width);
  const h = pixelSize(height);
  if (w !== undefined && h !== undefined && (w < 80 || h < 80)) return true;
  if ((w !== undefined && w <= 1) || (h !== undefined && h <= 1)) return true;
  return false;
}

function sizedThumbnail(pathname: string): boolean {
  const sized = /[_-](\d{1,4})x(\d{1,4})(?:[_-]|\.)/.exec(pathname);
  if (!sized) return false;
  return Number(sized[1]) < 80 || Number(sized[2]) < 80;
}

function bestSrcset(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let best: { url: string; width: number } | undefined;
  for (const part of value.split(',')) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0];
    if (!url) continue;
    const descriptor = bits[1];
    const width = descriptor?.endsWith('w') ? Number.parseInt(descriptor, 10) : 0;
    if (!best || width >= best.width) best = { url, width: Number.isFinite(width) ? width : 0 };
  }
  return best?.url;
}

export function absoluteImageUrl(raw: string | undefined, pageUrl: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed, pageUrl);
  } catch {
    return undefined;
  }
  url.hash = '';
  if (url.href.length > MAX_URL_LENGTH) return undefined;
  if (!isPublicHttpsImageUrl(url.href)) return undefined;
  if (/\.svg(?:$|\?)/i.test(url.pathname)) return undefined;
  if (JUNK.test(`${url.pathname}${url.search}`)) return undefined;
  if (sizedThumbnail(url.pathname)) return undefined;
  return url.href;
}

function unique(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

/** `og:image` first, then `<img>` sources. Relative URLs resolve against the page. */
export function imagesFromHtml(html: string, pageUrl: string): PageImages {
  const $ = load(html);
  const og: string[] = [];
  const img: string[] = [];
  $('meta').each((_, el) => {
    if (el.type !== 'tag') return;
    const node = $(el);
    const key = (node.attr('property') ?? node.attr('name') ?? '').toLowerCase();
    if (key !== 'og:image' && key !== 'og:image:url' && key !== 'og:image:secure_url') return;
    const url = absoluteImageUrl(node.attr('content'), pageUrl);
    if (url) og.push(url);
  });
  $('img').each((_, el) => {
    if (el.type !== 'tag') return;
    const node = $(el);
    if (isTiny(node.attr('width'), node.attr('height'))) return;
    const src = node.attr('src');
    const candidates = [
      bestSrcset(node.attr('srcset') ?? node.attr('data-srcset')),
      src && !src.trim().startsWith('data:') ? src : undefined,
      node.attr('data-src'),
    ];
    for (const raw of candidates) {
      const url = absoluteImageUrl(raw, pageUrl);
      if (!url) continue;
      img.push(url);
      break;
    }
  });
  return { og: unique(og), img: unique(img) };
}

function looksLikeHtml(body: string, contentType: string): boolean {
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) return true;
  if (contentType && !/text\/plain/i.test(contentType)) return false;
  const head = body.slice(0, 800).trimStart().toLowerCase();
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.includes('<head') ||
    head.includes('<meta') ||
    head.includes('<img')
  );
}

async function fetchHtml(ctx: SourceRunContext, startUrl: string): Promise<string | null> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isPublicHttpsImageUrl(current)) return null;
    let response: Response;
    try {
      response = await ctx.fetch(current, {
        redirect: 'manual',
        headers: { accept: 'text/html' },
      });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      try {
        current = new URL(location, current).href;
      } catch {
        return null;
      }
      continue;
    }
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) return null;
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > MAX_HTML_BYTES) return null;
    const html = new TextDecoder('utf-8', { fatal: false }).decode(body);
    if (!looksLikeHtml(html, contentType)) return null;
    return html;
  }
  return null;
}

async function fetchPage(ctx: SourceRunContext, url: string): Promise<PageFetch> {
  const html = await fetchHtml(ctx, url);
  if (!html) return { ok: false, og: [], img: [] };
  const found = imagesFromHtml(html, url);
  return { ok: true, og: found.og.slice(0, MAX_IMAGES), img: found.img.slice(0, MAX_IMAGES) };
}

async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (current !== undefined) await fn(current);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

/**
 * Follow each product's links and collect image URLs.
 * `null` means every fetch failed, so a later run can try again without clearing images.
 * An empty list means the pages loaded and had no usable images.
 */
export async function crawlLinkImages(
  ctx: SourceRunContext,
  pages: { id: string; urls: string[] }[],
): Promise<Record<string, string[] | null>> {
  const cache = new Map<string, Promise<PageFetch>>();
  let fetched = 0;
  const result: Record<string, string[] | null> = {};

  function load(url: string): Promise<PageFetch> {
    const existing = cache.get(url);
    if (existing) return existing;
    if (fetched >= MAX_PAGES) return Promise.resolve({ ok: false, og: [], img: [] });
    fetched += 1;
    const pending = fetchPage(ctx, url);
    cache.set(url, pending);
    return pending;
  }

  await mapPool(pages, CONCURRENCY, async (page) => {
    if (page.urls.length === 0) return;
    const og: string[] = [];
    const img: string[] = [];
    let ok = 0;
    for (const url of page.urls) {
      const found = await load(url);
      if (!found.ok) continue;
      ok += 1;
      og.push(...found.og);
      img.push(...found.img);
    }
    result[page.id] = ok === 0 ? null : unique([...og, ...img]).slice(0, MAX_IMAGES);
  });

  ctx.log('link images crawled', {
    pages: fetched,
    products: Object.keys(result).length,
    withImages: Object.values(result).filter((urls) => (urls?.length ?? 0) > 0).length,
  });
  return result;
}

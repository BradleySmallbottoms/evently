import { readFileSync } from 'node:fs';
import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { stockholmWallTime } from '../../../packages/domain/src/source-time';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource } from '../../../apps/data-workers/src/persist';
import {
  htmlCalendarOccasions,
  htmlCalendarSettings,
  mapHtmlCalendar,
  robotsAllows,
} from '../../../apps/data-workers/src/sources/html-calendar';

const listHtml = readFileSync(
  new URL(
    '../../../apps/data-workers/src/sources/html-calendar/fixture-list.html',
    import.meta.url,
  ),
  'utf8',
);
const detailHtml = readFileSync(
  new URL(
    '../../../apps/data-workers/src/sources/html-calendar/fixture-detail.html',
    import.meta.url,
  ),
  'utf8',
);
const page2Html = readFileSync(
  new URL(
    '../../../apps/data-workers/src/sources/html-calendar/fixture-page-2.html',
    import.meta.url,
  ),
  'utf8',
);

const config = {
  listUrl: 'https://calendar.example/evenemang/',
  item: 'a.event',
  link: 'a',
  next: 'a.next',
  organizerName: 'Hälsinglands museum',
  city: 'Hudiksvall',
  delayMs: 0,
  fields: {
    title: 'h1',
    description: '.block-content',
    date: { selector: 'time', attr: 'datetime' },
    price: '.block-content',
    address: '.address',
    image: { selector: 'img.hero', attr: 'src' },
  },
};

function wall(day: number, hour: number, minute = 0): string {
  return stockholmWallTime({ year: 2026, month: 11, day, hour, minute });
}

function ctx(
  fetchImpl: SourceRunContext['fetch'],
  extra: Record<string, unknown> = {},
): SourceRunContext {
  return {
    sourceSlug: 'html-calendar',
    config: { ...config, ...extra },
    fetch: fetchImpl,
    log: () => undefined,
  };
}

function htmlResponse(body: string, status = 200, url?: string): Response {
  const response = new Response(body, { status, headers: { 'content-type': 'text/html' } });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('html calendar dates', () => {
  it('reads a clock range, a whole day, and several dates', () => {
    expect(htmlCalendarOccasions('7 november 2026 kl. 19:00–21:00')).toEqual([
      { startsAt: wall(7, 19), endsAt: wall(7, 21) },
    ]);
    expect(htmlCalendarOccasions('7 november 2026')).toEqual([
      { startsAt: wall(7, 0), endsAt: wall(7, 0) },
    ]);
    expect(htmlCalendarOccasions('7 november 2026 kl. 19:00')).toEqual([
      { startsAt: wall(7, 19), endsAt: wall(7, 19) },
    ]);
    expect(htmlCalendarOccasions('07/11/2026 kl. 16:00 och 26/11/2026')).toEqual([
      { startsAt: wall(7, 16), endsAt: wall(7, 16) },
      { startsAt: wall(26, 0), endsAt: wall(26, 0) },
    ]);
    expect(htmlCalendarOccasions('2026-11-06T14:00:00.000+01:00')).toEqual([
      { startsAt: '2026-11-06T13:00:00.000Z', endsAt: '2026-11-06T13:00:00.000Z' },
    ]);
  });
});

describe('html calendar robots', () => {
  const body = `User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nDisallow: *?search*\n`;

  it('allows a public calendar and blocks a disallowed path', () => {
    expect(robotsAllows(body, new URL('https://calendar.example/evenemang/'))).toBe(true);
    expect(robotsAllows(body, new URL('https://calendar.example/wp-admin/'))).toBe(false);
    expect(robotsAllows(body, new URL('https://calendar.example/wp-admin/admin-ajax.php'))).toBe(
      true,
    );
    expect(robotsAllows(body, new URL('https://calendar.example/evenemang/?search=jazz'))).toBe(
      false,
    );
    expect(robotsAllows('', new URL('https://calendar.example/evenemang/'))).toBe(true);
  });
});

describe('html calendar map', () => {
  it('reads the detail page into one event', () => {
    const mapped = mapHtmlCalendar(
      {
        pageUrl: 'https://calendar.example/evenemang/jazz/',
        html: detailHtml,
        cardHtml: '<a class="event" href="/evenemang/jazz/">Jazz</a>',
      },
      config,
      'html-calendar',
    );
    expect(mapped).not.toBeNull();
    if (!mapped) return;
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped).toMatchObject({
      externalId: '/evenemang/jazz',
      title: 'Jazz med PIM',
      startsAt: '2026-11-06T13:00:00.000Z',
      endsAt: '2026-11-06T13:00:00.000Z',
      priceAmount: 0,
      currency: 'SEK',
      tags: [],
      categoryHints: [],
      sourceUrl: 'https://calendar.example/evenemang/jazz/',
      organizerName: 'Hälsinglands museum',
      imageUrl: 'https://calendar.example/images/jazz.jpg',
      imageUrls: ['https://calendar.example/images/jazz-2.jpg'],
      meta: {
        freeEntry: true,
        address: {
          address: 'Storgatan 31',
          zipCode: '82431',
          city: 'Hudiksvall',
          country: 'Sweden',
        },
      },
    });
    expect(mapped.location).toBeUndefined();
    expect(mapped.description).toBe('En kväll med jazz. Fritt inträde.\n\nBiljetter hos Tickster.');
    expect(mapped.organizerKeys).toEqual(['hälsinglands museum']);
    expect(mapped.links).toEqual([
      { type: 'info', url: 'https://calendar.example/evenemang/jazz/' },
      {
        type: 'tickets',
        url: 'https://www.tickster.com/se/sv/events/jazz-pim',
        label: 'Tickster',
      },
    ]);
    expect(mapped.occasions).toEqual([
      {
        startsAt: '2026-11-06T13:00:00.000Z',
        endsAt: '2026-11-06T13:00:00.000Z',
        sourceKey: '2026-11-06T13:00:00.000Z',
      },
    ]);
  });

  it('keeps paragraphs, a heading, a list, and a line break', () => {
    const mapped = mapHtmlCalendar(
      {
        pageUrl: 'https://calendar.example/evenemang/jazz/',
        html: `<h1>Jazz med PIM</h1>
          <div class="block-content">
            <h2>Om kvällen</h2>
            <p>Första raden.<br>Andra raden.</p>
            <ul><li>Jacka</li><li>Biljett</li></ul>
          </div>`,
        cardHtml: '',
      },
      config,
      'html-calendar',
    );
    expect(mapped?.description).toBe('Om kvällen\n\nFörsta raden.\nAndra raden.\n\nJacka\nBiljett');
  });

  it('keeps the query string in the external id', () => {
    const first = mapHtmlCalendar(
      {
        pageUrl: 'https://calendar.example/event/?id=123',
        html: '<h1>Jazz</h1>',
        cardHtml: '',
      },
      config,
      'html-calendar',
    );
    const second = mapHtmlCalendar(
      {
        pageUrl: 'https://calendar.example/event/?id=456',
        html: '<h1>Samtal</h1>',
        cardHtml: '',
      },
      config,
      'html-calendar',
    );
    expect(first?.externalId).toBe('/event?id=123');
    expect(second?.externalId).toBe('/event?id=456');
  });

  it('reads an ABF event page as a timed free event', () => {
    const mapped = mapHtmlCalendar(
      {
        pageUrl:
          'https://www.abf.se/halsingland/kurs/forelasning-om-vavning-som-kulturarv-3959755/',
        html: `<h1><span>Föreläsning - Väveriet som kulturarv</span></h1>
          <div class="HeroBlock-CourseInfo">
            <time datetime="2026-11-07 12:00:00">7 november 2026</time>
            <div>Tid <time datetime="12:00">12:00</time> - <time datetime="12:30">12:30</time></div>
            <a class="HeroBlock-CourseInfo-Text" href="https://www.google.com/maps/search/?api=1&query=x">Ljusdals museum, Boställsgatan 5 Ljusdal</a>
            <div>Pris Gratis</div>
          </div>
          <div class="CoursePage-MainContent"><p>Välkommen till öppet hus.</p><p>Ingen föranmälan.</p></div>
          <div data-target="similar-courses"><h1>Annan kurs</h1><p>1 december 2026 18.00</p></div>
          <meta property="og:image" content="https://www.abf.se/wp-content/uploads/sites/60/2026/11/vavning.jpg" />`,
        cardHtml: '',
      },
      {
        listUrl: 'https://www.abf.se/halsingland/kurs-sok/?type=event&display=list',
        item: 'article.EventCard',
        link: 'a',
        detailIgnore: '[data-target="similar-courses"]',
        organizerName: 'ABF Hälsingland',
        fields: {
          title: 'h1',
          description: '.CoursePage-MainContent',
          date: '.HeroBlock-CourseInfo',
          address: 'a.HeroBlock-CourseInfo-Text',
          price: '.HeroBlock-CourseInfo',
          image: { selector: 'meta[property="og:image"]', attr: 'content' },
        },
      },
      'abf-halsingland',
    );
    expect(mapped?.title).toBe('Föreläsning - Väveriet som kulturarv');
    expect(mapped?.startsAt).toBe('2026-11-07T12:00:00+01:00');
    expect(mapped?.endsAt).toBe('2026-11-07T12:30:00+01:00');
    expect(mapped?.priceAmount).toBe(0);
    expect(mapped?.meta).toMatchObject({
      freeEntry: true,
      address: { address: 'Ljusdals museum, Boställsgatan 5 Ljusdal', country: 'Sweden' },
    });
    expect(mapped?.description).toBe('Välkommen till öppet hus.\n\nIngen föranmälan.');
    expect(mapped?.imageUrl).toBe(
      'https://www.abf.se/wp-content/uploads/sites/60/2026/11/vavning.jpg',
    );
    expect(mapped?.organizerKeys).toEqual(['abf hälsingland']);
  });

  it('keeps an event whose page has no date', () => {
    const mapped = mapHtmlCalendar(
      {
        pageUrl: 'https://calendar.example/evenemang/samtal/',
        html: '<h1>Samtal</h1><div class="block-content"><p>Ingen tid.</p></div>',
        cardHtml: '',
      },
      config,
      'html-calendar',
    );
    expect(mapped?.title).toBe('Samtal');
    expect(mapped?.startsAt).toBeUndefined();
    expect(mapped?.occasions).toBeUndefined();
  });

  it('ignores a related list inside the detail page', () => {
    const mapped = mapHtmlCalendar(
      {
        pageUrl: 'https://calendar.example/evenemang/jazz/',
        html: `<article class="single"><h1>Jazz med PIM</h1><time datetime="2026-11-06T14:00:00.000+01:00"></time></article>
          <article class="e-loop-item"><h1>Annan kväll</h1><time datetime="2026-12-01T18:00:00.000+01:00"></time></article>`,
        cardHtml: '',
      },
      { ...config, detailIgnore: '.e-loop-item' },
      'html-calendar',
    );
    expect(mapped?.title).toBe('Jazz med PIM');
    expect(mapped?.startsAt).toBe('2026-11-06T13:00:00.000Z');
  });

  it('accepts the seeded site configs', () => {
    const sites = [
      {
        listUrl: 'https://halsinglandsmuseum.se/evenemang/',
        item: 'a.event',
        link: 'a',
        organizerName: 'Hälsinglands museum',
        city: 'Hudiksvall',
        fields: {
          title: 'h1',
          description: '.block-content',
          date: { selector: 'time', attr: 'datetime' },
          price: '.block-content',
        },
      },
      {
        listUrl: 'https://systrarnas.se/kalendarium/',
        item: '.e-loop-item',
        link: 'a',
        detailIgnore: '.e-loop-item',
        organizerName: 'Systrarna Söderström',
        city: 'Söderhamn',
        fields: {
          title: 'h1',
          description: '.elementor-widget-theme-post-content',
          date: '.elementor-icon-list-text',
          price: '.elementor-widget-theme-post-content',
        },
      },
      {
        listUrl: 'https://folkteaterngavleborg.se/aktuellt/',
        item: 'article.prog-item',
        link: 'a',
        organizerName: 'Folkteatern Gävleborg',
        fields: {
          title: 'h1.big-title',
          description: '#post_content',
          image: { selector: 'meta[property="og:image"]', attr: 'content' },
        },
      },
      {
        listUrl:
          'https://www.ovanaker.se/kulturochfritid/upplevovanakerskommun/dettahander.11286.html',
        item: 'li.eventcalendar-item',
        link: 'a',
        organizerName: 'Ovanåkers kommun',
        fields: {
          title: 'h1.heading',
          description: '#Ingress + .sv-text-portlet-content, #Innehall + .sv-text-portlet-content',
          price: '#Ingress + .sv-text-portlet-content, #Innehall + .sv-text-portlet-content',
          image: { selector: 'meta[property="og:image"]', attr: 'content' },
        },
      },
      {
        listUrl: 'https://www.abf.se/halsingland/kurs-sok/?type=event&display=list',
        item: 'article.EventCard',
        link: 'a',
        next: 'nav[aria-label="Sidnumrering"] a.text-xs.underline[href]:last-of-type',
        detailIgnore: '[data-target="similar-courses"]',
        organizerName: 'ABF Hälsingland',
        maxPages: 8,
        fields: {
          title: 'h1',
          description: '.CoursePage-MainContent',
          date: '.HeroBlock-CourseInfo',
          address: 'a.HeroBlock-CourseInfo-Text',
          price: '.HeroBlock-CourseInfo',
          image: { selector: 'meta[property="og:image"]', attr: 'content' },
        },
      },
    ];
    for (const site of sites) expect(() => htmlCalendarSettings(site)).not.toThrow();
  });

  it('refuses a private list url and a selector that is not css', () => {
    expect(() => htmlCalendarSettings({ ...config, listUrl: 'http://127.0.0.1/secret' })).toThrow(
      /public https/,
    );
    expect(() => htmlCalendarSettings({ ...config, item: '<script>' })).toThrow(/CSS selector/);
  });
});

describe('html calendar fetch', () => {
  function pages(url: URL): Response {
    if (url.pathname === '/robots.txt')
      return htmlResponse('User-agent: *\nDisallow:\n', 200, url.href);
    if (url.pathname === '/evenemang/' && url.search === '')
      return htmlResponse(listHtml, 200, url.href);
    if (url.pathname === '/evenemang/' && url.search === '?page=2') {
      return htmlResponse(page2Html, 200, url.href);
    }
    if (url.pathname === '/evenemang/jazz/') return htmlResponse(detailHtml, 200, url.href);
    if (url.pathname === '/evenemang/samtal/') {
      return htmlResponse(
        '<h1>Samtal</h1><div class="block-content"><p>Två.</p></div>',
        200,
        url.href,
      );
    }
    if (url.pathname === '/evenemang/arkiv/') {
      return htmlResponse('<h1>Arkivens dag</h1>', 200, url.href);
    }
    return htmlResponse('missing', 404, url.href);
  }

  it('saves the first event before the next detail and skips another host', async () => {
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '33333333-3333-4333-8333-333333333311',
      slug: 'html-calendar',
      trust: 'review',
      config,
      enabled: true,
    });
    const requested: string[] = [];
    let savedBeforeSecond = -1;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}${url.search}`);
      if (url.pathname === '/evenemang/samtal/') savedBeforeSecond = store.events.length;
      return pages(url);
    });
    try {
      const summary = await persistSource(store, 'html-calendar');
      expect(savedBeforeSecond).toBe(1);
      expect(summary.created).toBe(3);
      expect(store.events.map((row) => row.refId)).toEqual([
        '/evenemang/jazz',
        '/evenemang/samtal',
        '/evenemang/arkiv',
      ]);
      expect(store.events.map((row) => row.status)).toEqual([
        'pending_scan',
        'pending_scan',
        'pending_scan',
      ]);
      expect(requested).not.toContain('/evenemang/old;jsessionid=abc');
      expect(requested.some((path) => path.includes('evil.example'))).toBe(false);
      expect(store.events[0]?.meta?.freeEntry).toBe(true);
      expect(store.events[0]?.location).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not fetch a detail page when the list card is the event', async () => {
    const requested: string[] = [];
    const summary = await (
      await import('../../../apps/data-workers/src/sources/html-calendar')
    ).htmlCalendar.fetchRaw(
      ctx(
        async (input) => {
          const url = new URL(String(input));
          requested.push(url.pathname);
          if (url.pathname === '/robots.txt') return htmlResponse('', 200, url.href);
          return htmlResponse(
            '<a class="event" href="/evenemang/jazz/"><h1>Jazz</h1><time datetime="2026-11-06T14:00:00.000+01:00"></time></a>',
            200,
            url.href,
          );
        },
        { listOnly: true },
      ),
    );
    expect(requested).toEqual(['/robots.txt', '/evenemang/']);
    const [mapped] = (
      await import('../../../apps/data-workers/src/sources/html-calendar')
    ).htmlCalendar.map(
      summary,
      ctx(async () => htmlResponse('')),
    );
    expect(mapped?.title).toBe('Jazz');
    expect(mapped?.startsAt).toBe('2026-11-06T13:00:00.000Z');
  });

  it('stops when robots.txt disallows the list', async () => {
    const { htmlCalendar } = await import('../../../apps/data-workers/src/sources/html-calendar');
    await expect(
      htmlCalendar.fetchRaw(
        ctx(async (input) => {
          const url = new URL(String(input));
          if (url.pathname === '/robots.txt') {
            return htmlResponse('User-agent: *\nDisallow: /evenemang/\n', 200, url.href);
          }
          return htmlResponse(listHtml, 200, url.href);
        }),
      ),
    ).rejects.toThrow(/robots.txt disallows/);
  });

  it('skips a missing detail page and keeps the other event', async () => {
    const { htmlCalendar } = await import('../../../apps/data-workers/src/sources/html-calendar');
    const raw = await htmlCalendar.fetchRaw(
      ctx(
        async (input) => {
          const url = new URL(String(input));
          if (url.pathname === '/robots.txt') return htmlResponse('', 200, url.href);
          if (url.pathname === '/evenemang/') {
            return htmlResponse(
              '<a class="event" href="/evenemang/borta/">Borta</a><a class="event" href="/evenemang/jazz/">Jazz</a>',
              200,
              url.href,
            );
          }
          if (url.pathname === '/evenemang/jazz/')
            return htmlResponse('<h1>Jazz</h1>', 200, url.href);
          return htmlResponse('missing', 404, url.href);
        },
        { next: undefined },
      ),
    );
    expect(raw.pages.map((page) => page.pageUrl)).toEqual([
      'https://calendar.example/evenemang/jazz/',
    ]);
  });

  it('fails a list that redirected to another host', async () => {
    const { htmlCalendar } = await import('../../../apps/data-workers/src/sources/html-calendar');
    await expect(
      htmlCalendar.fetchRaw(
        ctx(async (input) => {
          const url = new URL(String(input));
          if (url.pathname === '/robots.txt') return htmlResponse('', 200, url.href);
          return htmlResponse(listHtml, 200, 'https://evil.example/evenemang/');
        }),
      ),
    ).rejects.toThrow(/off the calendar host/);
  });

  it('fails when the calendar page has no events', async () => {
    const { htmlCalendar } = await import('../../../apps/data-workers/src/sources/html-calendar');
    await expect(
      htmlCalendar.fetchRaw(
        ctx(async (input) => {
          const url = new URL(String(input));
          if (url.pathname === '/robots.txt') return htmlResponse('', 404, url.href);
          return htmlResponse('<p>Inget</p>', 200, url.href);
        }),
      ),
    ).rejects.toThrow(/found no events/);
  });
});

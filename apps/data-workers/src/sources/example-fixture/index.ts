import { defineAdapter, type IncomingEvent } from '@local-events/ingest';
import fixture from './fixture.json' with { type: 'json' };

interface RawItem {
  id: string;
  name: string;
  start: string;
  end?: string;
  venue: string;
  lat: number;
  lng: number;
  url: string;
  organizer: { id: string; name: string };
  tags: string[];
}

/**
 * Example adapter that reads a local fixture instead of the network. Copy this folder when
 * adding a real source (see .claude/skills/add-data-source).
 */
export const exampleFixture = defineAdapter<RawItem[]>({
  slug: 'example-fixture',
  kind: 'feed',
  async fetchRaw() {
    return fixture as RawItem[];
  },
  map(raw) {
    return raw.map((item): IncomingEvent => ({
      externalId: item.id,
      title: item.name,
      mode: 'physical',
      startsAt: item.start,
      endsAt: item.end,
      timezone: 'Europe/Stockholm',
      venueName: item.venue,
      location: { lat: item.lat, lng: item.lng },
      sourceUrl: item.url,
      links: [{ type: 'info', url: item.url }],
      organizerKey: item.organizer.id,
      organizerName: item.organizer.name,
      categoryHints: item.tags,
      tags: [],
    }));
  },
});

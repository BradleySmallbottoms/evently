import { describe, expect, it } from 'vitest';
import { contentHash, IncomingEvent, isLikelySameEvent, titleSimilarity } from '../../../packages/ingest/src/index';

const raw = {
  externalId: 'abc-1',
  title: 'Jazzkväll på Gamla Teatern',
  startsAt: '2026-11-07T19:00:00+01:00',
  sourceUrl: 'https://example.org/events/abc-1',
  organizerKey: 'gamla-teatern',
};

describe('IncomingEvent', () => {
  it('applies defaults', () => {
    const e = IncomingEvent.parse(raw);
    expect(e.mode).toBe('physical');
    expect(e.timezone).toBe('Europe/Stockholm');
  });
  it('hash is stable and changes with content', () => {
    const a = IncomingEvent.parse(raw);
    const b = IncomingEvent.parse({ ...raw });
    const c = IncomingEvent.parse({ ...raw, title: 'Jazzkväll (inställd)' });
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash(c));
  });
});

describe('dedupe', () => {
  it('matches the same event from two sources', () => {
    expect(
      titleSimilarity('Jazzkväll på Gamla Teatern', 'Jazzkväll - Gamla Teatern'),
    ).toBeGreaterThan(0.5);
    expect(
      isLikelySameEvent(
        { title: 'Jazzkväll på Gamla Teatern', startsAt: new Date('2026-11-07T18:00:00Z') },
        { title: 'Jazzkväll - Gamla Teatern', startsAt: new Date('2026-11-07T18:15:00Z') },
      ),
    ).toBe(true);
  });
  it('does not match different days', () => {
    expect(
      isLikelySameEvent(
        { title: 'Jazzkväll', startsAt: new Date('2026-11-07T18:00:00Z') },
        { title: 'Jazzkväll', startsAt: new Date('2026-11-14T18:00:00Z') },
      ),
    ).toBe(false);
  });
});

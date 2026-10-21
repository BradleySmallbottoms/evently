import { describe, expect, it } from 'vitest';

import {
  FOR_YOU_HOME_COUNT,
  FOR_YOU_RECENT_LIMIT,
  recentForYouSignals,
  selectForYouEvents,
} from '../../../packages/domain/src/for-you';

function event(id: string, tagIds: string[], publisherId = 'pub-a', featured = false) {
  return { id, tagIds, publisherId, featured };
}

describe('recentForYouSignals', () => {
  it('keeps the newest interactions and ignores how old they are', () => {
    const items = Array.from({ length: FOR_YOU_RECENT_LIMIT + 5 }, (_, index) => index);
    expect(recentForYouSignals(items)).toEqual(items.slice(0, FOR_YOU_RECENT_LIMIT));
  });
});

describe('selectForYouEvents', () => {
  const concert = event('seed', ['music'], 'pub-a');

  it('picks upcoming events that share a tag with a recent interaction', () => {
    const picked = selectForYouEvents({
      signals: [concert],
      followedPublisherIds: [],
      selectedTagIds: [],
      candidates: [
        event('featured', ['music'], 'pub-b', true),
        event('same', ['music'], 'pub-b'),
        event('other', ['sport'], 'pub-b'),
        event('seed', ['music'], 'pub-a'),
      ],
    });
    expect(picked.map((item) => item.id)).toEqual(['same']);
  });

  it('includes events from a followed publisher', () => {
    const picked = selectForYouEvents({
      signals: [],
      followedPublisherIds: ['pub-followed'],
      selectedTagIds: [],
      candidates: [event('theirs', ['sport'], 'pub-followed'), event('other', ['sport'], 'pub-b')],
    });
    expect(picked.map((item) => item.id)).toEqual(['theirs']);
  });

  it('applies the selected home tags on top of similarity', () => {
    const picked = selectForYouEvents({
      signals: [event('seed', ['music', 'family'])],
      followedPublisherIds: ['pub-followed'],
      selectedTagIds: ['family'],
      candidates: [
        event('music-only', ['music'], 'pub-b'),
        event('family-show', ['family'], 'pub-b'),
        event('their-sport', ['sport'], 'pub-followed'),
      ],
    });
    expect(picked.map((item) => item.id)).toEqual(['family-show']);
  });

  it('never returns an event that is in the featured row', () => {
    const picked = selectForYouEvents({
      signals: [concert],
      followedPublisherIds: [],
      selectedTagIds: [],
      featuredIds: new Set(['on-screen']),
      candidates: [event('on-screen', ['music']), event('later', ['music'])],
    });
    expect(picked.map((item) => item.id)).toEqual(['later']);
  });

  it('ranks a closer tag match ahead of a single shared tag', () => {
    const picked = selectForYouEvents({
      signals: [event('seed', ['music', 'family'])],
      followedPublisherIds: [],
      selectedTagIds: [],
      candidates: [event('one', ['music']), event('both', ['music', 'family'])],
    });
    expect(picked.map((item) => item.id)).toEqual(['both', 'one']);
  });

  it('returns nothing until there is an interaction or a followed publisher', () => {
    expect(
      selectForYouEvents({
        signals: [],
        followedPublisherIds: [],
        selectedTagIds: ['music'],
        candidates: [event('gig', ['music'])],
      }),
    ).toEqual([]);
  });

  it('stops at the home row size', () => {
    const candidates = Array.from({ length: FOR_YOU_HOME_COUNT + 3 }, (_, index) =>
      event(`e-${index}`, ['music']),
    );
    const picked = selectForYouEvents({
      signals: [concert],
      followedPublisherIds: [],
      selectedTagIds: [],
      candidates,
    });
    expect(picked).toHaveLength(FOR_YOU_HOME_COUNT);
  });
});

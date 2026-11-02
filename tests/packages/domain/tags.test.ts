import { eventMatchesTagIds, tagSlug } from '../../../packages/domain/src/tags';
import { describe, expect, it } from 'vitest';

describe('eventMatchesTagIds', () => {
  it('matches any tag, or only the first tag', () => {
    expect(eventMatchesTagIds(['music', 'sport'], [], 'primary')).toBe(true);
    expect(eventMatchesTagIds(['music', 'sport'], ['sport'])).toBe(true);
    expect(eventMatchesTagIds(['music', 'sport'], ['sport'], 'primary')).toBe(false);
    expect(eventMatchesTagIds(['music', 'sport'], ['music'], 'primary')).toBe(true);
    expect(eventMatchesTagIds([], ['music'], 'primary')).toBe(false);
  });
});

describe('tagSlug', () => {
  it('folds Swedish letters the same way as the seed tags', () => {
    expect(tagSlug('Idrott & Tävlingar')).toBe('idrott-tavlingar');
    expect(tagSlug('Högtider')).toBe('hogtider');
    expect(tagSlug('Jul & Nyår')).toBe('jul-nyar');
    expect(tagSlug('Mässor & Utställningar')).toBe('massor-utstallningar');
    expect(tagSlug('Bandy & Innebandy')).toBe('bandy-innebandy');
    expect(tagSlug('Utställning')).toBe('utstallning');
  });
});

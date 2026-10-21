import {
  choosePublisher,
  sharedOrganizerKeyKind,
  type PublisherCandidate,
} from '../../../packages/domain/src/publisher-match';
import { describe, expect, it } from 'vitest';

const slugs = ['glada-hudik', 'visit-soderhamn'];

function row(
  overrides: Partial<PublisherCandidate> &
    Pick<PublisherCandidate, 'publisherId' | 'key'> & { near?: boolean },
): PublisherCandidate {
  const { near = false, ...rest } = overrides;
  return {
    sourceId: 'other-source',
    status: 'in_review',
    createdAt: 1,
    distanceMeters: near ? 0 : -1,
    ...rest,
  };
}

describe('sharedOrganizerKeyKind', () => {
  it('treats a host and a host plus path as a website', () => {
    expect(sharedOrganizerKeyKind('soderhamn.se', slugs)).toBe('host');
    expect(sharedOrganizerKeyKind('soderhamn.se/aquarena', slugs)).toBe('host');
    expect(sharedOrganizerKeyKind('kulturhuset', slugs)).toBe('name');
  });
});

describe('choosePublisher', () => {
  it('keeps this source mapping ahead of another source', () => {
    const chosen = choosePublisher('this-source', ['kansli@example.com'], slugs, [
      row({ publisherId: 'other', key: 'kansli@example.com', status: 'published', createdAt: 1 }),
      row({
        publisherId: 'ours',
        sourceId: 'this-source',
        key: 'kansli@example.com',
        createdAt: 5,
      }),
    ]);
    expect(chosen?.publisherId).toBe('ours');
  });

  it('reuses an email from another source and prefers a verified publisher', () => {
    const chosen = choosePublisher('this-source', ['kansli@example.com'], slugs, [
      row({ publisherId: 'older', key: 'kansli@example.com', createdAt: 1 }),
      row({
        publisherId: 'verified',
        key: 'kansli@example.com',
        status: 'published',
        createdAt: 9,
      }),
    ]);
    expect(chosen?.publisherId).toBe('verified');
  });

  it('reuses a nearby name and ignores the same name far away', () => {
    const near = choosePublisher('this-source', ['kulturhuset'], slugs, [
      row({ publisherId: 'near', key: 'kulturhuset', near: true }),
      row({ publisherId: 'far', key: 'kulturhuset', createdAt: 0 }),
    ]);
    expect(near?.publisherId).toBe('near');
    const far = choosePublisher('this-source', ['kulturhuset'], slugs, [
      row({ publisherId: 'far', key: 'kulturhuset' }),
    ]);
    expect(far).toBeNull();
  });

  it('does not reuse a source slug from another worker', () => {
    const chosen = choosePublisher('this-source', ['glada-hudik'], slugs, [
      row({ publisherId: 'glada', key: 'glada-hudik', near: true }),
    ]);
    expect(chosen).toBeNull();
  });
});

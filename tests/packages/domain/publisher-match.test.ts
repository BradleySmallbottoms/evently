import { choosePublisher, type PublisherCandidate } from '../../../packages/domain/src/publisher-match';
import { describe, expect, it } from 'vitest';

const slugs = ['glada-hudik', 'visit-soderhamn'];

function row(overrides: Partial<PublisherCandidate> & Pick<PublisherCandidate, 'publisherId' | 'key'>): PublisherCandidate {
  return {
    sourceId: 'other-source',
    verified: false,
    createdAt: 1,
    near: false,
    ...overrides,
  };
}

describe('choosePublisher', () => {
  it('keeps this source mapping ahead of another source', () => {
    const chosen = choosePublisher('this-source', ['kansli@example.com'], slugs, [
      row({ publisherId: 'other', key: 'kansli@example.com', verified: true, createdAt: 1 }),
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
      row({ publisherId: 'verified', key: 'kansli@example.com', verified: true, createdAt: 9 }),
    ]);
    expect(chosen?.publisherId).toBe('verified');
  });

  it('reuses a nearby name and ignores the same name far away', () => {
    const near = choosePublisher('this-source', ['kulturhuset'], slugs, [
      row({ publisherId: 'near', key: 'kulturhuset', near: true }),
      row({ publisherId: 'far', key: 'kulturhuset', near: false, createdAt: 0 }),
    ]);
    expect(near?.publisherId).toBe('near');
    const far = choosePublisher('this-source', ['kulturhuset'], slugs, [
      row({ publisherId: 'far', key: 'kulturhuset', near: false }),
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

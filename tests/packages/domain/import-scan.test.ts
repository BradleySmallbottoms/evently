import { describe, expect, it } from 'vitest';
import { statusAfterImportScan } from '../../../packages/domain/src/import-scan';

describe('statusAfterImportScan', () => {
  const ready = {
    approved: true,
    publisherVerified: true,
    publisherIsTemporary: false,
    sourceTrust: 'auto_publish' as const,
    possibleDuplicate: false,
  };

  it('publishes a verified publisher on an auto-publish source', () => {
    expect(statusAfterImportScan(ready)).toBe('published');
  });

  it('keeps an unverified publisher in review', () => {
    expect(statusAfterImportScan({ ...ready, publisherVerified: false })).toBe('in_review');
  });

  it('keeps a temporary publisher in review', () => {
    expect(statusAfterImportScan({ ...ready, publisherIsTemporary: true })).toBe('in_review');
  });

  it('keeps a review-trust source in review', () => {
    expect(statusAfterImportScan({ ...ready, sourceTrust: 'review' })).toBe('in_review');
  });

  it('keeps a possible duplicate in review', () => {
    expect(statusAfterImportScan({ ...ready, possibleDuplicate: true })).toBe('in_review');
  });

  it('keeps an unapproved event in review', () => {
    expect(statusAfterImportScan({ ...ready, approved: false })).toBe('in_review');
  });
});

import { describe, expect, it } from 'vitest';
import { canReportEvent } from '../../../packages/domain/src/reports';

describe('canReportEvent', () => {
  it('allows a published listing', () => {
    expect(canReportEvent('published')).toBe(true);
  });

  it('rejects drafts and review states', () => {
    expect(canReportEvent('draft')).toBe(false);
    expect(canReportEvent('awaiting_verification')).toBe(false);
    expect(canReportEvent('in_review')).toBe(false);
    expect(canReportEvent('cancelled')).toBe(false);
    expect(canReportEvent('ended')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  aggregatedMoreCopy,
  bundledPushPresentation,
  canAdminNotifyEvent,
  canCreateNewPushDraft,
  isAdminEventPushAudience,
  defaultPushMessageCopy,
  initialPushMessageStatus,
  isWithinAggregationWindow,
  pickPrimaryPushMessage,
  shouldAutoApprovePushMessage,
  statusAfterDraftEdit,
} from '../../../packages/domain/src/push-messages';

describe('push-messages domain', () => {
  it('auto-approves verified native and mapped auto_publish imports', () => {
    expect(
      shouldAutoApprovePushMessage({ publisherVerified: true, origin: 'native' }),
    ).toBe(true);
    expect(
      shouldAutoApprovePushMessage({ publisherVerified: false, origin: 'native' }),
    ).toBe(false);
    expect(
      shouldAutoApprovePushMessage({
        publisherVerified: false,
        origin: 'imported',
        sourceTrust: 'auto_publish',
        publisherIsTemporary: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoApprovePushMessage({
        publisherVerified: false,
        origin: 'imported',
        sourceTrust: 'auto_publish',
        publisherIsTemporary: true,
      }),
    ).toBe(false);
  });

  it('re-pends approved drafts after untrusted edit', () => {
    expect(statusAfterDraftEdit({ current: 'approved', autoApprove: false })).toBe('pending');
    expect(statusAfterDraftEdit({ current: 'approved', autoApprove: true })).toBe('approved');
    expect(statusAfterDraftEdit({ current: 'sent', autoApprove: false })).toBe('sent');
  });

  it('builds default bilingual copy and aggregation lines', () => {
    const copy = defaultPushMessageCopy('Konsert');
    expect(copy.titleSv).toBe('Konsert');
    expect(copy.bodySv).toContain('nära');
    expect(copy.bodyEn).toContain('near');
    expect(aggregatedMoreCopy('en', 1)).toBe('And 1 more…');
    expect(aggregatedMoreCopy('sv', 2)).toBe('Och 2 till…');
  });

  it('picks earliest message as primary in a bundle', () => {
    const primary = pickPrimaryPushMessage([
      {
        id: 'b',
        sendAt: new Date('2026-06-15T12:10:00Z'),
        titleSv: 'B',
        bodySv: 'b',
        titleEn: 'B',
        bodyEn: 'b',
      },
      {
        id: 'a',
        sendAt: new Date('2026-06-15T12:00:00Z'),
        titleSv: 'A',
        bodySv: 'a',
        titleEn: 'A',
        bodyEn: 'a',
      },
    ]);
    expect(primary.id).toBe('a');
    const presented = bundledPushPresentation('en', [
      primary,
      {
        id: 'b',
        sendAt: new Date('2026-06-15T12:10:00Z'),
        titleSv: 'B',
        bodySv: 'b',
        titleEn: 'B',
        bodyEn: 'b',
      },
    ]);
    expect(presented.title).toBe('A');
    expect(presented.body).toContain('And 1 more…');
  });

  it('lets admins notify only published events', () => {
    expect(canAdminNotifyEvent('published')).toBe(true);
    expect(canAdminNotifyEvent('draft')).toBe(false);
    expect(canAdminNotifyEvent('in_review')).toBe(false);
    expect(canAdminNotifyEvent('awaiting_verification')).toBe(false);
    expect(canAdminNotifyEvent('cancelled')).toBe(false);
    expect(canAdminNotifyEvent('ended')).toBe(false);
    expect(isAdminEventPushAudience('area')).toBe(true);
    expect(isAdminEventPushAudience('area_and_tag')).toBe(true);
    expect(isAdminEventPushAudience('event_match')).toBe(false);
    expect(isAdminEventPushAudience('everyone')).toBe(false);
  });

  it('detects aggregation window and new-draft eligibility', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(isWithinAggregationWindow(now, new Date('2026-06-15T12:09:00Z'))).toBe(true);
    expect(isWithinAggregationWindow(now, new Date('2026-06-15T12:11:00Z'))).toBe(false);
    expect(canCreateNewPushDraft(null)).toBe(true);
    expect(canCreateNewPushDraft('pending')).toBe(false);
    expect(initialPushMessageStatus(true)).toBe('approved');
  });
});

import { describe, expect, it } from 'vitest';
import {
  aggregatedMoreCopy,
  bundledPushPresentation,
  canAdminNotifyEvent,
  canCreateNewPushDraft,
  isAdminEventPushAudience,
  defaultPushMessageCopy,
  DEFAULT_MARKETING_PUSH_PLAN,
  importNotificationMessages,
  initialPushMessageStatus,
  marketingPushPlan,
  offsetBeforeEventStart,
  reminderPushCopy,
  isWithinAggregationWindow,
  pickPrimaryPushMessage,
  shouldAutoApprovePushMessage,
  importPlanToSchedule,
  pushStatusForEvent,
  statusAfterDraftEdit,
} from '../../../packages/domain/src/push-messages';

describe('push-messages domain', () => {
  it('auto-approves verified native and mapped auto_publish imports', () => {
    expect(shouldAutoApprovePushMessage({ publisherVerified: true, origin: 'native' })).toBe(true);
    expect(shouldAutoApprovePushMessage({ publisherVerified: false, origin: 'native' })).toBe(
      false,
    );
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

  it('builds reminder times and the standard marketing plan', () => {
    const start = new Date('2026-06-20T18:00:00.000Z');
    expect(offsetBeforeEventStart(start, 'week').toISOString()).toBe('2026-06-13T18:00:00.000Z');
    expect(offsetBeforeEventStart(start, 'day').toISOString()).toBe('2026-06-19T18:00:00.000Z');
    expect(offsetBeforeEventStart(start, 'hour').toISOString()).toBe('2026-06-20T17:00:00.000Z');
    const week = reminderPushCopy('Jazzkväll', 'week');
    expect(week.titleSv).toBe('Jazzkväll');
    expect(week.bodySv).toContain('vecka');
    expect(week.bodyEn).toContain('week');
    expect(DEFAULT_MARKETING_PUSH_PLAN).toBe('single');
    expect(marketingPushPlan('single')?.offsets).toEqual(['day']);
    expect(marketingPushPlan('standard')?.offsets).toEqual(['week', 'day']);
    expect(marketingPushPlan('full')?.offsets).toEqual(['week', 'day', 'hour']);
  });

  it('schedules import reminders only for a verified publisher with a plan', () => {
    expect(importPlanToSchedule({ publisherVerified: true, planId: 'single' })).toBe('single');
    expect(importPlanToSchedule({ publisherVerified: false, planId: 'full' })).toBeNull();
    expect(importPlanToSchedule({ publisherVerified: true, planId: null })).toBeNull();

    const startsAt = new Date('2026-06-20T18:00:00.000Z');
    const now = new Date('2026-06-19T12:00:00.000Z');
    const messages = importNotificationMessages({
      planId: 'full',
      eventTitle: 'Jazzkväll',
      startsAt,
      now,
    });
    expect(messages.map((message) => message.offset)).toEqual(['day', 'hour']);
    expect(messages[0]?.copy.bodySv).toContain('imorgon');
    expect(messages[0]?.sendAt.toISOString()).toBe('2026-06-19T18:00:00.000Z');
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

  it('lets admins notify events that are not cancelled or ended', () => {
    expect(canAdminNotifyEvent('published')).toBe(true);
    expect(canAdminNotifyEvent('draft')).toBe(true);
    expect(canAdminNotifyEvent('in_review')).toBe(true);
    expect(canAdminNotifyEvent('awaiting_verification')).toBe(true);
    expect(canAdminNotifyEvent('cancelled')).toBe(false);
    expect(canAdminNotifyEvent('ended')).toBe(false);
    expect(pushStatusForEvent('published')).toBe('approved');
    expect(pushStatusForEvent('in_review')).toBe('pending');
    expect(pushStatusForEvent('draft')).toBe('pending');
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

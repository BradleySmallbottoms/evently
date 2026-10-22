import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../apps/mobile/src/lib/identity', () => ({
  ensureIdentity: vi.fn(),
}));

vi.mock('../../../apps/mobile/src/lib/tips', () => ({
  listTips: vi.fn(),
}));

import { ensureIdentity } from '../../../apps/mobile/src/lib/identity';
import { openInboxItem } from '../../../apps/mobile/src/lib/open-inbox-item';
import { listTips } from '../../../apps/mobile/src/lib/tips';

const eventId = '22222222-2222-4222-8222-222222222222';
const tipId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.mocked(ensureIdentity).mockReset();
  vi.mocked(listTips).mockReset();
  vi.mocked(ensureIdentity).mockResolvedValue({ userId: 'user' } as never);
});

describe('openInboxItem', () => {
  it('opens a published tip on the thank-you screen', async () => {
    vi.mocked(listTips).mockResolvedValue({
      items: [{ id: tipId, eventId, phase: 'published' }],
    } as never);
    const push = vi.fn();
    const openTip = vi.fn();

    const opened = await openInboxItem({ push }, 'sv', { reason: 'tip', eventId }, openTip);

    expect(opened).toBe(false);
    expect(openTip).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/tips/published/${tipId}`);
  });

  it('opens any other tip on its status sheet', async () => {
    vi.mocked(listTips).mockResolvedValue({
      items: [{ id: tipId, eventId, phase: 'review' }],
    } as never);
    const push = vi.fn();
    const openTip = vi.fn();

    const opened = await openInboxItem({ push }, 'en', { reason: 'tip', eventId }, openTip);

    expect(opened).toBe(true);
    expect(openTip).toHaveBeenCalledWith({ tipId, screen: 'status' });
    expect(push).not.toHaveBeenCalled();
  });

  it('opens the event when the tip is no longer on this account', async () => {
    vi.mocked(listTips).mockResolvedValue({ items: [] } as never);
    const push = vi.fn();
    const openTip = vi.fn();

    const opened = await openInboxItem({ push }, 'sv', { reason: 'tip', eventId }, openTip);

    expect(opened).toBe(false);
    expect(openTip).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/events/${eventId}`);
  });

  it('opens the event when the tip cannot be loaded', async () => {
    vi.mocked(listTips).mockRejectedValue(new Error('offline'));
    const push = vi.fn();
    const openTip = vi.fn();

    const opened = await openInboxItem({ push }, 'sv', { reason: 'tip', eventId }, openTip);

    expect(opened).toBe(false);
    expect(openTip).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/events/${eventId}`);
  });

  it('opens my tips when a tip notification has no event', async () => {
    const push = vi.fn();

    const opened = await openInboxItem({ push }, 'sv', { reason: 'tip', eventId: null }, vi.fn());

    expect(opened).toBe(false);
    expect(listTips).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/profile/tips');
  });

  it('opens the event for a notification that is not a tip', async () => {
    const push = vi.fn();

    const opened = await openInboxItem({ push }, 'sv', { reason: 'nearby', eventId }, vi.fn());

    expect(opened).toBe(false);
    expect(listTips).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/events/${eventId}`);
  });
});

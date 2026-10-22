import { ensureIdentity } from './identity';
import { listTips } from './tips';

type InboxRouter = {
  push: (href: `/events/${string}` | `/tips/published/${string}` | '/profile/tips') => void;
};

/** A tip from the notification list that is not the thank-you screen. That screen is a route. */
export type InboxTipTarget = {
  tipId: string;
  screen: 'status';
};

/**
 * Opens a published tip on the thank-you screen, any other tip through `openTip`,
 * an event on its page, and a tip with no event on My tips.
 * Returns true when a tip sheet was requested.
 */
export async function openInboxItem(
  router: InboxRouter,
  locale: 'sv' | 'en',
  item: { reason: string; eventId: string | null },
  openTip: (tip: InboxTipTarget) => void,
): Promise<boolean> {
  if (item.reason === 'tip' && item.eventId) {
    try {
      const identity = await ensureIdentity(locale);
      const tips = await listTips(identity);
      const tip = tips.items.find((row) => row.eventId === item.eventId);
      if (tip) {
        if (tip.phase === 'published') {
          router.push(`/tips/published/${tip.id}`);
          return false;
        }
        openTip({ tipId: tip.id, screen: 'status' });
        return true;
      }
    } catch {
      // The event page is the fallback when the tip cannot be loaded.
    }
  }
  if (item.eventId) {
    router.push(`/events/${item.eventId}`);
    return false;
  }
  if (item.reason === 'tip') router.push('/profile/tips');
  return false;
}

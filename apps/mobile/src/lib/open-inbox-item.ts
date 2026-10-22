import { ensureIdentity } from './identity';
import { listTips } from './tips';

type InboxRouter = {
  push: (
    href: `/events/${string}` | `/tips/${string}` | `/tips/published/${string}` | '/profile/tips',
  ) => void;
};

/** Opens a published tip on the thank-you screen, any other tip on its status, and the rest on the event. */
export async function openInboxItem(
  router: InboxRouter,
  locale: 'sv' | 'en',
  item: { reason: string; eventId: string | null },
): Promise<void> {
  if (item.reason === 'tip' && item.eventId) {
    try {
      const identity = await ensureIdentity(locale);
      const tips = await listTips(identity);
      const tip = tips.items.find((row) => row.eventId === item.eventId);
      if (tip) {
        if (tip.phase === 'published') router.push(`/tips/published/${tip.id}`);
        else router.push(`/tips/${tip.id}`);
        return;
      }
    } catch {
      // The event page is the fallback when the tip cannot be loaded.
    }
  }
  if (item.eventId) {
    router.push(`/events/${item.eventId}`);
    return;
  }
  if (item.reason === 'tip') router.push('/profile/tips');
}

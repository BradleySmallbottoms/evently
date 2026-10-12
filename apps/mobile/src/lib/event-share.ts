import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';

import { buildEventWebUrl, eventShareMessage } from './event-share-url';

export { buildEventWebUrl, eventShareMessage, webBaseUrl } from './event-share-url';

export type ShareEventResult = 'shared' | 'copied' | 'dismissed';

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

/**
 * Opens the OS share sheet (Messages, Messenger, Facebook, Mail, Copy, …)
 * with the public event URL in the shared text.
 * On web, uses the browser share sheet, then the clipboard.
 */
export async function shareEventLink(input: {
  title: string;
  eventId: string;
}): Promise<ShareEventResult> {
  const url = buildEventWebUrl(input.eventId);
  const message = eventShareMessage(input.title, url);

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title: input.title, text: input.title, url });
        return 'shared';
      } catch (error) {
        if (isAbortError(error)) return 'dismissed';
      }
    }
    await Clipboard.setStringAsync(url);
    return 'copied';
  }

  const present = () =>
    Share.share(
      Platform.OS === 'android' ? { title: input.title, message } : { message },
      { subject: input.title },
    );

  try {
    const result = await present();
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch (error) {
    if (isAbortError(error)) return 'dismissed';
    // The overflow menu can still be dismissing when the sheet is requested.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const result = await present();
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  }
}

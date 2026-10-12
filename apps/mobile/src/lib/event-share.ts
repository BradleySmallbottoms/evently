import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';

import { buildEventWebUrl, eventShareContent } from './event-share-url';

export { buildEventWebUrl, eventShareContent, eventShareMessage, webBaseUrl } from './event-share-url';

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
 * with the public event link.
 * On web, uses the browser share sheet, then the clipboard.
 */
export async function shareEventLink(input: {
  title: string;
  eventId: string;
}): Promise<ShareEventResult> {
  const url = buildEventWebUrl(input.eventId);
  const platform = Platform.OS === 'android' ? 'android' : Platform.OS === 'web' ? 'web' : 'ios';
  const content = eventShareContent(input.title, url, platform);

  if (platform === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({
          title: content.title,
          text: content.message,
          url: content.url ?? url,
        });
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
      platform === 'android'
        ? { title: content.title, message: content.message ?? url }
        : { url: content.url ?? url },
      { subject: input.title, dialogTitle: input.title },
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

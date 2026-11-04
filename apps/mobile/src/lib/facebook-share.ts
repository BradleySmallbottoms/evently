import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import {
  eventOutboundUrl,
  facebookShareTarget,
  facebookWebSharerUrl,
} from './facebook-share-target';

export type FacebookShareResult = 'shared' | 'dismissed' | 'unavailable';

/**
 * Opens the Facebook app's composer with the event link.
 * Native mode is required: automatic mode often picks the in-app browser,
 * which shows a login page even when the Facebook app is signed in.
 * If the app is missing, or this binary was built before the SDK was added,
 * the browser sharer is used instead.
 */
async function openNativeDialog(
  url: string,
  kind: 'facebook' | 'messenger',
): Promise<FacebookShareResult | 'unavailable'> {
  try {
    const { MessageDialog, Settings, ShareDialog } = await import('react-native-fbsdk-next');
    const appId = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID?.trim();
    const clientToken = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN?.trim();
    if (!appId || !clientToken) return 'unavailable';
    Settings.setAutoLogAppEventsEnabled(false);
    Settings.setAdvertiserIDCollectionEnabled(false);
    Settings.setAppID(appId);
    Settings.setClientToken(clientToken);
    Settings.initializeSDK();
    const content = { contentType: 'link' as const, contentUrl: url };
    const dialog = kind === 'facebook' ? ShareDialog : MessageDialog;
    if (kind === 'facebook') ShareDialog.setMode('native');
    if (!(await dialog.canShow(content))) return 'unavailable';
    const result = await dialog.show(content);
    return result.isCancelled ? 'dismissed' : 'shared';
  } catch {
    return 'unavailable';
  }
}

function sharePlatform(): 'ios' | 'android' | 'web' {
  return Platform.OS === 'android' ? 'android' : Platform.OS === 'web' ? 'web' : 'ios';
}

function nativeDialogReady(): boolean {
  return (
    facebookShareTarget({
      appId: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
      clientToken: process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN,
      platform: sharePlatform(),
    }) === 'dialog'
  );
}

export async function shareEventOnFacebook(input: {
  eventId: string;
  links: readonly { type: string; url: string }[];
}): Promise<FacebookShareResult> {
  const url = eventOutboundUrl(input);
  if (nativeDialogReady()) {
    const opened = await openNativeDialog(url, 'facebook');
    if (opened !== 'unavailable') return opened;
  }
  await WebBrowser.openBrowserAsync(facebookWebSharerUrl(url));
  return 'shared';
}

/**
 * Opens Messenger with the same link as the Facebook post.
 * The person still chooses who receives it. A raw Messenger address makes
 * Messenger return to this app at once, so only the Messenger dialog is used.
 */
export async function shareEventOnMessenger(input: {
  eventId: string;
  links: readonly { type: string; url: string }[];
}): Promise<FacebookShareResult> {
  const url = eventOutboundUrl(input);
  if (!nativeDialogReady()) return 'unavailable';
  return openNativeDialog(url, 'messenger');
}

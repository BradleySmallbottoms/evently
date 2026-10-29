import '@/i18n';
import '@/lib/inbox-push-task';

import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { InboxPushSync } from '@/components/inbox-push-sync';
import { NotificationEventLink } from '@/components/notification-event-link';
import { IdentityResetAlert } from '@/components/native/identity-reset-alert';
import { OnboardingCover } from '@/components/onboarding-cover';
import { OtaUpdateBanner } from '@/components/ota-update-banner';
import { PermissionReminder } from '@/components/onboarding/permission-reminder';
import { AfterSplash, SplashCover } from '@/components/splash-cover';
import {
  currentIdentityEpoch,
  discardStoredIdentity,
  loadStoredIdentity,
  setIdentityRejectedHandler,
  verifyStoredIdentity,
} from '@/lib/identity';
import {
  loadOnboardingState,
  reconcileGrantedPermissions,
  recordAppActivation,
  type OnboardingState,
  type PermissionKind,
} from '@/lib/onboarding';
import { DEFAULT_ONBOARDING_STATE } from '@/lib/onboarding-state';
import { OnboardingVisibleProvider } from '@/lib/onboarding-visibility';
import { installOtaUpdateChecks } from '@/lib/ota-update-check';
import { clearAppIconBadge } from '@/lib/push-notifications';
import { refreshDeviceLocation, startDeviceLocation } from '@/lib/device-location';
import { createAppQueryClient, subscribeQueryFocus } from '@/lib/query-client';
import { initSentry } from '@/lib/sentry';
import { brand } from '@/theme/colors';

initSentry();
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { t } = useTranslation();
  const [queryClient] = useState(() => createAppQueryClient());
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [splashSeen, setSplashSeen] = useState(false);
  const [reminder, setReminder] = useState<PermissionKind | null>(null);
  const [identityLost, setIdentityLost] = useState(false);
  const appStateRef = useRef(AppState.currentState);
  const onboardingRef = useRef<OnboardingState | null>(null);
  const identityLostRef = useRef(false);
  /** True after the app has been in the background, until the next active verify. */
  const sawBackgroundRef = useRef(false);
  /** Avoid counting twice for the same foreground (cold start + brief inactive). */
  const countedThisForegroundRef = useRef(false);
  const bootstrappedRef = useRef(false);
  const resettingRef = useRef(false);
  const hidNativeSplash = useRef(false);
  const hideNativeSplash = useCallback(() => {
    if (hidNativeSplash.current) return;
    hidNativeSplash.current = true;
    void SplashScreen.hideAsync();
  }, []);
  const markSplashSeen = useCallback(() => setSplashSeen(true), []);
  const closeOnboarding = useCallback(() => setShowOnboarding(false), []);

  useEffect(() => {
    onboardingRef.current = onboarding;
  }, [onboarding]);

  useEffect(() => {
    identityLostRef.current = identityLost;
  }, [identityLost]);

  useEffect(() => {
    setIdentityRejectedHandler(() => setIdentityLost(true));
    return () => setIdentityRejectedHandler(null);
  }, []);

  useEffect(() => subscribeQueryFocus(AppState, Platform.OS), []);
  useEffect(() => installOtaUpdateChecks(), []);

  const countActivation = useCallback(async (state: OnboardingState) => {
    if (!state.completed || countedThisForegroundRef.current || identityLostRef.current) return;
    countedThisForegroundRef.current = true;
    const reconciled = await reconcileGrantedPermissions(state);
    const result = await recordAppActivation(reconciled);
    setOnboarding(result.state);
    if (result.reminder) setReminder(result.reminder);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await loadOnboardingState();
      if (cancelled) return;
      const reconciled = state.completed ? await reconcileGrantedPermissions(state) : state;
      if (cancelled) return;
      const identity = await loadStoredIdentity();
      if (cancelled) return;
      if (identity) {
        const epoch = currentIdentityEpoch();
        const check = await verifyStoredIdentity();
        if (cancelled || epoch !== currentIdentityEpoch()) return;
        if (check === 'invalid') {
          setOnboarding(reconciled);
          setIdentityLost(true);
          bootstrappedRef.current = true;
          return;
        }
      }
      setShowOnboarding(!reconciled.completed || !identity);
      setOnboarding(reconciled);
      bootstrappedRef.current = true;
      if (reconciled.completed && identity && AppState.currentState === 'active') {
        await countActivation(reconciled);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countActivation]);

  useEffect(() => {
    if (Platform.OS !== 'web' && AppState.currentState === 'active') {
      void clearAppIconBadge();
    }
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;

      if (Platform.OS !== 'web' && next === 'active' && prev !== 'active') {
        void clearAppIconBadge();
      }

      if (next === 'background') {
        countedThisForegroundRef.current = false;
        sawBackgroundRef.current = true;
        return;
      }

      if (!bootstrappedRef.current) return;
      if (next !== 'active' || !sawBackgroundRef.current) return;
      sawBackgroundRef.current = false;
      if (identityLostRef.current) return;

      const epoch = currentIdentityEpoch();
      void (async () => {
        const check = await verifyStoredIdentity();
        if (epoch !== currentIdentityEpoch()) return;
        if (check === 'invalid') {
          setIdentityLost(true);
          return;
        }
        const current = onboardingRef.current;
        if (current) void countActivation(current);
      })();
    });
    return () => sub.remove();
  }, [countActivation]);

  const confirmIdentityReset = useCallback(async () => {
    if (resettingRef.current) return;
    resettingRef.current = true;
    try {
      await discardStoredIdentity();
      queryClient.clear();
      setReminder(null);
      setOnboarding({ ...DEFAULT_ONBOARDING_STATE });
      setShowOnboarding(true);
      setIdentityLost(false);
      countedThisForegroundRef.current = false;
    } finally {
      resettingRef.current = false;
    }
  }, [queryClient]);

  const shellReady = onboarding != null && !identityLost;
  useEffect(() => {
    if (!shellReady) return;
    return startDeviceLocation();
  }, [shellReady]);

  if (!onboarding) return null;

  const resetAlert = (
    <IdentityResetAlert
      title={t('identity.resetTitle')}
      message={t('identity.resetMessage')}
      confirmLabel={t('identity.resetConfirm')}
      isPresented={identityLost}
      onConfirm={() => {
        void confirmIdentityReset();
      }}
    />
  );

  if (identityLost) {
    return (
      <GestureHandlerRootView
        onLayout={hideNativeSplash}
        style={{ flex: 1, backgroundColor: brand.canvas }}
      >
        {resetAlert}
      </GestureHandlerRootView>
    );
  }

  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: brand.primary,
      background: brand.canvas,
      card: brand.card,
      text: brand.ink,
      border: brand.line,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={navTheme}>
          <SplashCover
            alreadySeen={splashSeen}
            onCovered={hideNativeSplash}
            onDismissed={markSplashSeen}
            waitForHome={!showOnboarding}
          >
            <OnboardingVisibleProvider visible={showOnboarding}>
              <InboxPushSync />
              <NotificationEventLink />
              <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="map" />
                <Stack.Screen name="events/[id]" />
                <Stack.Screen
                  name="tips/published/[id]"
                  options={{
                    presentation: 'transparentModal',
                    animation: 'fade',
                    animationDuration: 220,
                    contentStyle: { backgroundColor: 'transparent' },
                  }}
                />
                <Stack.Screen name="for-you" />
                <Stack.Screen name="preferences/index" />
              </Stack>
              {showOnboarding ? (
                <OnboardingCover
                  onFinished={(state) => {
                    setOnboarding(state);
                    setReminder(null);
                    countedThisForegroundRef.current = false;
                    void countActivation(state);
                  }}
                  onHidden={closeOnboarding}
                />
              ) : null}
              <OtaUpdateBanner />
              <AfterSplash>
                {!showOnboarding && reminder ? (
                  <PermissionReminder
                    kind={reminder}
                    state={onboarding}
                    onDone={(state) => {
                      setOnboarding(state);
                      setReminder(null);
                      void refreshDeviceLocation();
                    }}
                  />
                ) : null}
              </AfterSplash>
            </OnboardingVisibleProvider>
          </SplashCover>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

import '@/i18n';
import '@/lib/inbox-push-task';

import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { InboxPushSync } from '@/components/inbox-push-sync';
import { NotificationEventLink } from '@/components/notification-event-link';
import { OnboardingCarousel } from '@/components/onboarding/onboarding-carousel';
import { PermissionReminder } from '@/components/onboarding/permission-reminder';
import {
  loadOnboardingState,
  reconcileGrantedPermissions,
  recordAppActivation,
  type OnboardingState,
  type PermissionKind,
} from '@/lib/onboarding';
import { loadStoredIdentity } from '@/lib/identity';
import { clearAppIconBadge } from '@/lib/push-notifications';
import { refreshDeviceLocation, startDeviceLocation } from '@/lib/device-location';
import { createAppQueryClient, subscribeQueryFocus } from '@/lib/query-client';
import { initSentry } from '@/lib/sentry';
import { brand } from '@/theme/colors';

initSentry();
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(() => createAppQueryClient());
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [reminder, setReminder] = useState<PermissionKind | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const onboardingRef = useRef<OnboardingState | null>(null);
  /** Avoid counting twice for the same foreground (cold start + brief inactive). */
  const countedThisForegroundRef = useRef(false);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    onboardingRef.current = onboarding;
  }, [onboarding]);

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  useEffect(() => subscribeQueryFocus(AppState, Platform.OS), []);

  const countActivation = useCallback(async (state: OnboardingState) => {
    if (!state.completed || countedThisForegroundRef.current) return;
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
        return;
      }

      if (!bootstrappedRef.current) return;
      if (prev === 'background' && next === 'active') {
        const current = onboardingRef.current;
        if (current) void countActivation(current);
      }
    });
    return () => sub.remove();
  }, [countActivation]);

  useEffect(() => {
    if (!onboarding?.completed || showOnboarding) return;
    return startDeviceLocation();
  }, [onboarding?.completed, showOnboarding]);

  if (!onboarding) return null;

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

  if (showOnboarding) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <OnboardingCarousel
          onFinished={(state) => {
            setOnboarding(state);
            setShowOnboarding(false);
            setReminder(null);
            countedThisForegroundRef.current = false;
            void countActivation(state);
          }}
        />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={navTheme}>
          <AnimatedSplashOverlay />
          <InboxPushSync />
          <NotificationEventLink />
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="map" />
            <Stack.Screen name="events/[id]" />
            <Stack.Screen name="for-you" />
            <Stack.Screen name="preferences/index" />
          </Stack>
          {reminder ? (
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
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

import '@/i18n';

import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ReminderNotificationLink } from '@/components/reminder-notification-link';
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
import { initSentry } from '@/lib/sentry';
import { brand } from '@/theme/colors';

initSentry();
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
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
      const reconciled = state.completed
        ? await reconcileGrantedPermissions(state)
        : state;
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
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;

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
          <ReminderNotificationLink />
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
              }}
            />
          ) : null}
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

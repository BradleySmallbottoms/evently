import { useSegments } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeOut, runOnJS, useReducedMotion } from 'react-native-reanimated';

import AppSplash from '@/components/splash-screen';
import { shouldHoldSplashForHome } from '@/lib/home-splash';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const FADE_MS = 280;
const FADE_REDUCED_MS = 120;
/** Escape hatch when location or the list never settles. */
const HOME_READY_TIMEOUT_MS = 12_000;

const ReportHomeReadyContext = createContext<(() => void) | null>(null);
const SplashDismissedContext = createContext(false);

function noop() {}

export function useReportHomeReady(): () => void {
  return useContext(ReportHomeReadyContext) ?? noop;
}

export function useSplashDismissed(): boolean {
  return useContext(SplashDismissedContext);
}

/** Renders only after the splash fade has finished. Native modals ignore z-order. */
export function AfterSplash({ children }: { children: ReactNode }) {
  const dismissed = useSplashDismissed();
  if (!dismissed) return null;
  return children;
}

/**
 * Mounts the next screen underneath a full-screen splash. The cover fades
 * after the intro. On the home screen it also waits until the event list has
 * settled, so the reveal shows the screen that is already painted.
 */
export function SplashCover({
  children,
  onCovered,
  onDismissed,
  waitForHome = true,
  alreadySeen = false,
}: {
  children: ReactNode;
  onCovered: () => void;
  onDismissed?: () => void;
  /** When false, the intro alone dismisses the cover. Used before onboarding. */
  waitForHome?: boolean;
  /** Skip a second splash after this launch already played one. */
  alreadySeen?: boolean;
}) {
  const reduced = useReducedMotion();
  const segments = useSegments();
  const holdForHome = waitForHome && shouldHoldSplashForHome(segments);
  const [introDone, setIntroDone] = useState(alreadySeen);
  const [reportedReady, setReportedReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [visible, setVisible] = useState(!alreadySeen);
  const [dismissed, setDismissed] = useState(alreadySeen);
  const homeReady = reportedReady || timedOut || !holdForHome;

  const reportHomeReady = useCallback(() => setReportedReady(true), []);
  const markIntroDone = useCallback(() => setIntroDone(true), []);
  const markDismissed = useCallback(() => {
    setDismissed(true);
    onDismissed?.();
  }, [onDismissed]);

  const exiting = useMemo(
    () =>
      FadeOut.duration(reduced ? FADE_REDUCED_MS : FADE_MS)
        .easing(EASE_OUT)
        .withCallback((finished) => {
          'worklet';
          if (finished) runOnJS(markDismissed)();
        }),
    [markDismissed, reduced],
  );

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), HOME_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!introDone || !homeReady) return;
    let cancelled = false;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (!cancelled) setVisible(false);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [introDone, homeReady]);

  return (
    <ReportHomeReadyContext.Provider value={reportHomeReady}>
      <SplashDismissedContext.Provider value={dismissed}>
        <View onLayout={alreadySeen ? onCovered : undefined} style={styles.fill}>
          {children}
          {visible ? (
            <Animated.View
              accessibilityViewIsModal
              collapsable={false}
              exiting={exiting}
              onLayout={onCovered}
              pointerEvents="auto"
              style={styles.cover}
            >
              <AppSplash onIntroEnd={markIntroDone} />
            </Animated.View>
          ) : null}
        </View>
      </SplashDismissedContext.Provider>
    </ReportHomeReadyContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  cover: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    backgroundColor: '#FFF8F0',
  },
});

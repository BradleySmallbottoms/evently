import { useFocusEffect } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { appliedColorScheme, applyColorScheme } from '@/theme/colors';

import { loadAppearance, saveAppearance } from './appearance-store';
import { resolveAppearance, type AppearancePreference, type ColorScheme } from './appearance';

type AppearanceContextValue = {
  preference: AppearancePreference;
  scheme: ColorScheme;
  setPreference: (preference: AppearancePreference) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

type SchemeOverride = 'light' | 'dark' | 'auto';

function setNativeScheme(preference: AppearancePreference) {
  const appearance = Appearance as typeof Appearance & {
    setColorScheme?: (scheme: SchemeOverride) => void;
  };
  try {
    appearance.setColorScheme?.(preference === 'system' ? 'auto' : preference);
  } catch {
    // The JS palette still follows the preference when the native override is missing.
  }
}

/** Applies the saved appearance and keeps `colors` in step with it. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<AppearancePreference>('system');
  const system = useColorScheme();
  const scheme = resolveAppearance(preference, system);
  applyColorScheme(scheme);
  setNativeScheme(preference);

  useEffect(() => {
    let cancelled = false;
    void loadAppearance().then((stored) => {
      if (!cancelled) setPreferenceState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = (next: AppearancePreference) => {
    setPreferenceState(next);
    void saveAppearance(next);
  };

  return (
    <AppearanceContext.Provider value={{ preference, scheme, setPreference }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('AppearanceProvider is missing');
  return value;
}

/**
 * Remount key for native views that keep the first color they were given.
 * A hidden tab may miss the context update, so focusing it bumps the key
 * when the live palette has moved on.
 */
export function useSchemeKey(): string {
  const { scheme } = useAppearance();
  const [epoch, setEpoch] = useState(0);
  const mounted = useRef(scheme);

  useEffect(() => {
    mounted.current = scheme;
  }, [scheme]);

  useFocusEffect(
    useCallback(() => {
      const live = appliedColorScheme();
      if (mounted.current === live) return;
      mounted.current = live;
      setEpoch((value) => value + 1);
    }, []),
  );

  return `${scheme}-${epoch}`;
}

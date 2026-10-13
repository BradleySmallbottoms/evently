import { resolveTravelDistanceM } from '@local-events/domain';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { OnboardingAreaStep } from '@/components/onboarding/onboarding-area-step';
import { OnboardingTagsStep } from '@/components/onboarding/onboarding-tags-step';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ensureIdentity } from '@/lib/identity';
import { saveHomeTagIds } from '@/lib/home-tag-selection';
import { createCircleArea, getPreferences, updateTravelDistance } from '@/lib/preferences';
import { setDiscoveryPlaceId } from '@/lib/use-discovery-point';
import {
  loadOnboardingState,
  markOnboardingComplete,
  requestLocationPermission,
  requestNotificationPermission,
  setPermissionChoice,
  type OnboardingState,
  type PermissionKind,
} from '@/lib/onboarding';
import { registerPushToken } from '@/lib/push-notifications';
import { deferRegionPromptAfterAreaSkip } from '@/lib/region-suggestion';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type StepId = 'welcome' | 'notifications' | 'location' | 'area' | 'tags';

const TAGS_INDEX = 4;

const STEPS: { id: StepId; image: ImageSourcePropType }[] = [
  { id: 'welcome', image: require('@/assets/images/onboarding_1.png') },
  { id: 'notifications', image: require('@/assets/images/onboarding_2.png') },
  { id: 'location', image: require('@/assets/images/onboarding_3.png') },
  { id: 'area', image: require('@/assets/images/onboarding_4.png') },
  { id: 'tags', image: require('@/assets/images/onboarding_5.png') },
];

type Props = {
  onFinished: (state: OnboardingState) => void;
};

export function OnboardingCarousel({ onFinished }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const savedAreaRequest = useRef<Promise<string | null> | null>(null);

  const ensureUser = useCallback(async () => {
    try {
      const identity = await ensureIdentity(locale);
      setError(null);
      return identity;
    } catch (err) {
      console.warn('ensureIdentity failed', err);
      const detail = err instanceof Error ? err.message : '';
      setError(detail ? `${t('home.identityError')} (${detail})` : t('home.identityError'));
      return null;
    }
  }, [locale, t]);

  const firstSavedAreaId = useCallback(async (): Promise<string | null> => {
    if (!savedAreaRequest.current) {
      savedAreaRequest.current = (async () => {
        const identity = await ensureIdentity(locale);
        const preferences = await getPreferences(identity);
        const first = [...preferences.areas].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        )[0];
        return first?.id ?? null;
      })().catch((err) => {
        console.warn('onboarding areas failed', err);
        return null;
      });
    }
    return savedAreaRequest.current;
  }, [locale]);

  useEffect(() => {
    void ensureUser();
    void firstSavedAreaId().then((id) => {
      if (id) void setDiscoveryPlaceId(id);
    });
  }, [ensureUser, firstSavedAreaId]);

  const ensureState = useCallback(async (): Promise<OnboardingState> => {
    if (state) return state;
    const loaded = await loadOnboardingState();
    setState(loaded);
    return loaded;
  }, [state]);

  const goTo = (next: number) => {
    scrollRef.current?.scrollTo({ x: next * SCREEN_WIDTH, animated: true });
    setIndex(next);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (next < 0 || next >= STEPS.length) return;
    setIndex(next);
  };

  const finish = useCallback(
    async (next: OnboardingState) => {
      const completed = await markOnboardingComplete(next);
      setState(completed);
      onFinished(completed);
    },
    [onFinished],
  );

  const onWelcomeContinue = async () => {
    const current = await ensureState();
    setState(current);
    goTo(1);
  };

  const onActivate = async (kind: PermissionKind) => {
    setBusy(true);
    try {
      let current = await ensureState();
      if (kind === 'notifications') {
        // Ask the OS first so Activate never waits on API / Expo push registration.
        const choice = await requestNotificationPermission(null);
        current = await setPermissionChoice(current, 'notifications', choice);
        if (choice === 'granted') {
          void ensureUser().then((identity) => {
            if (!identity) return;
            void registerPushToken(identity).catch((err) => {
              console.warn(
                'push token registration failed',
                err instanceof Error ? err.message : 'unknown error',
              );
            });
          });
        }
      } else {
        const choice = await requestLocationPermission();
        current = await setPermissionChoice(current, 'location', choice);
      }
      setState(current);
      const stepIndex = STEPS.findIndex((step) => step.id === kind);
      if (stepIndex >= 0 && stepIndex < STEPS.length - 1) {
        goTo(stepIndex + 1);
      } else {
        await finish(current);
      }
    } catch (err) {
      console.warn('onboarding activate failed', err);
      setError(t('home.identityError'));
    } finally {
      setBusy(false);
    }
  };

  const onSaveArea = async (place: { name: string; lat: number; lng: number; radiusM: number }) => {
    setBusy(true);
    setError(null);
    try {
      const identity = await ensureUser();
      if (!identity) return;
      await updateTravelDistance(identity, resolveTravelDistanceM(place.radiusM));
      const area = await createCircleArea(identity, place);
      await setDiscoveryPlaceId(area.id);
      goTo(TAGS_INDEX);
    } catch (err) {
      console.warn('onboarding area save failed', err);
      setError(t('onboarding.areaSaveError'));
    } finally {
      setBusy(false);
    }
  };

  const onSkipArea = async (detected: { lat: number; lng: number } | null) => {
    setBusy(true);
    try {
      await deferRegionPromptAfterAreaSkip(detected);
      goTo(TAGS_INDEX);
    } finally {
      setBusy(false);
    }
  };

  const onSkip = async (kind: PermissionKind) => {
    setBusy(true);
    try {
      let current = await ensureState();
      current = await setPermissionChoice(current, kind, 'skipped');
      setState(current);
      const stepIndex = STEPS.findIndex((step) => step.id === kind);
      if (stepIndex >= 0 && stepIndex < STEPS.length - 1) {
        goTo(stepIndex + 1);
      } else {
        await finish(current);
      }
    } finally {
      setBusy(false);
    }
  };

  const onSaveTags = async (tagIds: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await saveHomeTagIds(tagIds);
      await finish(await ensureState());
    } catch (err) {
      console.warn('onboarding tags save failed', err);
      setError(t('onboarding.tagsSaveError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={[styles.dots, { top: insets.top + space.md }]}>
        {STEPS.map((step, i) => (
          <View
            key={step.id}
            style={{
              width: i === index ? 28 : 8,
              height: 8,
              borderRadius: radius.pill,
              backgroundColor: i === index ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
            }}
          />
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        directionalLockEnabled
        nestedScrollEnabled
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={onScrollEnd}
        scrollEventThrottle={16}
        style={styles.scroll}
      >
        <StepFrame
          image={STEPS[0]!.image}
          title={t('onboarding.welcomeTitle')}
          body={t('onboarding.welcomeBody')}
          bottomInset={insets.bottom}
          error={error}
        >
          <PrimaryButton
            label={t('onboarding.continue')}
            onPress={() => void onWelcomeContinue()}
            disabled={busy}
          />
        </StepFrame>

        <StepFrame
          image={STEPS[1]!.image}
          title={t('onboarding.notificationsTitle')}
          body={t('onboarding.notificationsBody')}
          bottomInset={insets.bottom}
          error={error}
        >
          <PrimaryButton
            label={t('onboarding.activate')}
            loading={busy}
            onPress={() => void onActivate('notifications')}
          />
          <SkipButton
            label={t('onboarding.skip')}
            disabled={busy}
            onPress={() => void onSkip('notifications')}
          />
        </StepFrame>

        <StepFrame
          image={STEPS[2]!.image}
          title={t('onboarding.locationTitle')}
          body={t('onboarding.locationBody')}
          bottomInset={insets.bottom}
          error={error}
        >
          <PrimaryButton
            label={t('onboarding.activate')}
            loading={busy}
            onPress={() => void onActivate('location')}
          />
          <SkipButton
            label={t('onboarding.skip')}
            disabled={busy}
            onPress={() => void onSkip('location')}
          />
        </StepFrame>

        <StepFrame
          image={STEPS[3]!.image}
          title={t('onboarding.areaTitle')}
          body={
            state?.location === 'granted'
              ? t('onboarding.areaBodyLocated')
              : t('onboarding.areaBodySearch')
          }
          bottomInset={insets.bottom}
          error={error}
        >
          <OnboardingAreaStep
            active={index === 3}
            locationGranted={state?.location === 'granted'}
            fallbackName={t('events.locationHere')}
            busy={busy}
            onSave={(place) => {
              void onSaveArea(place);
            }}
            onSkip={(detected) => {
              void onSkipArea(detected);
            }}
          />
        </StepFrame>

        <StepFrame
          image={STEPS[4]!.image}
          title={t('onboarding.tagsTitle')}
          body={t('onboarding.tagsBody')}
          bottomInset={insets.bottom}
          error={error}
          fill
        >
          <OnboardingTagsStep
            busy={busy}
            onContinue={(tagIds) => {
              void onSaveTags(tagIds);
            }}
            onSkip={() => {
              void onSaveTags([]);
            }}
          />
        </StepFrame>
      </ScrollView>
    </View>
  );
}

function StepFrame({
  image,
  title,
  body,
  accentLabel,
  accentSoft,
  bottomInset,
  error,
  fill,
  children,
}: {
  image: ImageSourcePropType;
  title: string;
  body: string;
  accentLabel?: string;
  accentSoft?: string;
  bottomInset: number;
  error?: string | null;
  /** Let the step body use the space under the title, for the interest grid. */
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.step}>
      <Image
        pointerEvents="none"
        source={image}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <View
        style={[
          styles.content,
          fill ? styles.contentFill : null,
          {
            paddingTop: fill ? space.xxxl * 2 + space.lg : space.xxxl * 2,
            paddingBottom: bottomInset + space.lg,
          },
        ]}
      >
        <View style={styles.copy}>
          {accentLabel ? (
            <ShadowedText
              variant="label"
              style={{ color: accentSoft, textTransform: 'uppercase', letterSpacing: 1.2 }}
            >
              {accentLabel}
            </ShadowedText>
          ) : null}
          <ShadowedText variant="hero" style={[styles.title, fill ? styles.titleFill : null]}>
            {title}
          </ShadowedText>
          <ShadowedText variant="body" style={styles.body}>
            {body}
          </ShadowedText>
        </View>
        <View style={fill ? styles.actionsFill : styles.actions}>
          {error ? (
            <ShadowedText variant="caption" intensity="soft" style={styles.error}>
              {error}
            </ShadowedText>
          ) : null}
          {children}
        </View>
      </View>
    </View>
  );
}

function SkipButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        paddingVertical: space.sm,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <ShadowedText
        variant="caption"
        intensity="soft"
        style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}
      >
        {label}
      </ShadowedText>
    </Pressable>
  );
}

/**
 * Native `textShadow*` is often too weak (or ignored). Stack a 1px offset
 * dark copy under the live text so the drop shadow stays visible on photos.
 */
function ShadowedText({
  children,
  variant,
  style,
  intensity = 'strong',
}: {
  children: string;
  variant: 'hero' | 'title' | 'subtitle' | 'body' | 'caption' | 'label';
  style?: StyleProp<TextStyle>;
  intensity?: 'strong' | 'soft';
}) {
  const soft = intensity === 'soft';
  return (
    <View>
      <AppText
        variant={variant}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[style, soft ? styles.shadowLayerSoft : styles.shadowLayer]}
      >
        {children}
      </AppText>
      <AppText
        variant={variant}
        style={[
          style,
          soft
            ? {
                textShadowColor: 'rgba(0, 0, 0, 0.4)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 2,
              }
            : {
                textShadowColor: 'rgba(0, 0, 0, 0.65)',
                textShadowOffset: { width: 0, height: 2 },
                textShadowRadius: 8,
              },
        ]}
      >
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
  },
  scroll: {
    flex: 1,
  },
  step: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    paddingHorizontal: space.xxl,
    justifyContent: 'flex-end',
    gap: space.xxl,
  },
  contentFill: {
    justifyContent: 'flex-start',
    gap: space.lg,
  },
  copy: {
    gap: space.md,
  },
  title: {
    color: '#FFFFFF',
  },
  titleFill: {
    fontSize: 30,
    lineHeight: 34,
  },
  body: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 17,
    lineHeight: 26,
  },
  error: {
    color: '#FFFFFF',
    textAlign: 'center',
  },
  shadowLayer: {
    position: 'absolute',
    left: 1,
    top: 2,
    color: 'rgba(0, 0, 0, 0.45)',
  },
  shadowLayerSoft: {
    position: 'absolute',
    left: 0.5,
    top: 1,
    color: 'rgba(0, 0, 0, 0.28)',
  },
  actions: {
    gap: space.md,
  },
  actionsFill: {
    flex: 1,
    minHeight: 0,
    gap: space.md,
  },
});

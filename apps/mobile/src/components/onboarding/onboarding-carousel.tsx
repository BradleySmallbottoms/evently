import { resolveTravelDistanceM } from '@local-events/domain';
import { useQueryClient } from '@tanstack/react-query';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
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
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AcknowledgeAlert } from '@/components/native/acknowledge-alert';
import { ConfirmAction } from '@/components/native/confirm-action';
import { OnboardingAreaStep } from '@/components/onboarding/onboarding-area-step';
import { OnboardingTagsStep } from '@/components/onboarding/onboarding-tags-step';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton, type ButtonIcon } from '@/components/ui/primary-button';
import { ensureIdentity } from '@/lib/identity';
import { publishArea, publishHomeTagIds, publishPreferences } from '@/lib/home-discovery-cache';
import { whenObservedHomeListSettles } from '@/lib/home-splash';
import { saveHomeTagIds } from '@/lib/home-tag-selection';
import {
  createCircleArea,
  getPreferences,
  updateAreaTags,
  updateTravelDistance,
} from '@/lib/preferences';
import {
  getDiscoveryPlaceId,
  NEARBY_PLACE_ID,
  setDiscoveryPlaceId,
} from '@/lib/use-discovery-point';
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
import { refreshDeviceLocation } from '@/lib/device-location';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type StepId = 'welcome' | 'notifications' | 'location' | 'area' | 'tags';
type CelebrateId = Exclude<StepId, 'welcome'>;

const TAGS_INDEX = 4;
const DENY_ALERT_DELAY_MS = 420;

type LeavePrompt = {
  id: CelebrateId;
  source: 'skip' | 'denied';
  detected?: { lat: number; lng: number } | null;
};

const LEAVE_COPY: Record<CelebrateId, { title: string; message: string }> = {
  notifications: {
    title: 'onboarding.skipNotificationsTitle',
    message: 'onboarding.skipNotificationsMessage',
  },
  location: {
    title: 'onboarding.skipLocationTitle',
    message: 'onboarding.skipLocationMessage',
  },
  area: {
    title: 'onboarding.skipAreaTitle',
    message: 'onboarding.skipAreaMessage',
  },
  tags: {
    title: 'onboarding.skipTagsTitle',
    message: 'onboarding.skipTagsMessage',
  },
};

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
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  const reachedRef = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [reached, setReached] = useState(0);
  const [busy, setBusy] = useState(false);
  const [celebrated, setCelebrated] = useState<CelebrateId | null>(null);
  const [rejected, setRejected] = useState<PermissionKind | null>(null);
  const [leavePrompt, setLeavePrompt] = useState<LeavePrompt | null>(null);
  const [awaitingDenyAlert, setAwaitingDenyAlert] = useState(false);
  const afterCelebrate = useRef<(() => void) | null>(null);
  const leavePromptRef = useRef<LeavePrompt | null>(null);
  const denyAlertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  leavePromptRef.current = leavePrompt;
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
    const furthest = Math.max(reachedRef.current, next);
    reachedRef.current = furthest;
    indexRef.current = next;
    pendingScroll.current = next;
    setReached(furthest);
    setIndex(next);
  };

  useEffect(() => {
    const target = pendingScroll.current;
    if (target == null) return;
    pendingScroll.current = null;
    const x = target * SCREEN_WIDTH;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x, animated: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [reached, index]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    let next = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (next < 0) next = 0;
    if (next > reachedRef.current) next = reachedRef.current;
    indexRef.current = next;
    setIndex(next);
    setCelebrated(null);
  };

  const finish = useCallback(
    async (next: OnboardingState) => {
      const completed = await markOnboardingComplete(next);
      setState(completed);
      onFinished(completed);
    },
    [onFinished],
  );

  const celebrateThen = (id: CelebrateId, next: () => void) => {
    afterCelebrate.current = next;
    setCelebrated(id);
  };

  const clearDenyAlertTimer = () => {
    if (!denyAlertTimer.current) return;
    clearTimeout(denyAlertTimer.current);
    denyAlertTimer.current = null;
  };

  useEffect(() => {
    return () => {
      if (denyAlertTimer.current) clearTimeout(denyAlertTimer.current);
    };
  }, []);

  const openLeavePrompt = (prompt: LeavePrompt) => {
    clearDenyAlertTimer();
    setAwaitingDenyAlert(false);
    leavePromptRef.current = prompt;
    setLeavePrompt(prompt);
  };

  const onCelebrated = useCallback(() => {
    const next = afterCelebrate.current;
    afterCelebrate.current = null;
    next?.();
    // Momentum end also clears this. The timer covers a scroll that never reports end.
    setTimeout(() => setCelebrated(null), 450);
  }, []);

  const onWelcomeContinue = async () => {
    const current = await ensureState();
    setState(current);
    goTo(1);
  };

  const onActivate = async (kind: PermissionKind) => {
    if (leavePromptRef.current || denyAlertTimer.current) return;
    setBusy(true);
    setCelebrated(null);
    try {
      let current = await ensureState();
      const choice =
        kind === 'notifications'
          ? await requestNotificationPermission(null)
          : await requestLocationPermission();
      current = await setPermissionChoice(current, kind, choice);
      if (kind === 'location' && choice === 'granted') void refreshDeviceLocation();
      if (kind === 'notifications' && choice === 'granted') {
        // Ask the OS first so Activate never waits on API / Expo push registration.
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
      setState(current);
      const stepIndex = STEPS.findIndex((step) => step.id === kind);
      const advance = () => {
        if (stepIndex >= 0 && stepIndex < STEPS.length - 1) goTo(stepIndex + 1);
        else void finish(current);
      };
      if (choice === 'granted') {
        setRejected((current) => (current === kind ? null : current));
        celebrateThen(kind, advance);
        return;
      }
      setRejected(kind);
      setAwaitingDenyAlert(true);
      clearDenyAlertTimer();
      denyAlertTimer.current = setTimeout(() => {
        denyAlertTimer.current = null;
        setAwaitingDenyAlert(false);
        openLeavePrompt({ id: kind, source: 'denied' });
      }, DENY_ALERT_DELAY_MS);
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
      await queryClient.cancelQueries({ queryKey: ['preferences', identity.userId] });
      publishPreferences(queryClient, identity.userId, await getPreferences(identity));
      await setDiscoveryPlaceId(area.id);
      celebrateThen('area', () => goTo(TAGS_INDEX));
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

  const onSaveTags = async (tagIds: string[], celebrate = true) => {
    setBusy(true);
    setError(null);
    try {
      const identity = await ensureUser();
      if (!identity) return;
      await saveHomeTagIds(tagIds);
      await queryClient.cancelQueries({ queryKey: ['home-tag-ids'] });
      publishHomeTagIds(queryClient, tagIds);
      const placeId = getDiscoveryPlaceId();
      if (placeId !== NEARBY_PLACE_ID) {
        const area = await updateAreaTags(
          identity,
          placeId,
          tagIds,
          tagIds.length === 0 ? { notify: false } : undefined,
        );
        await queryClient.cancelQueries({ queryKey: ['preferences', identity.userId] });
        publishArea(queryClient, identity.userId, area);
      }
      const current = await ensureState();
      const reveal = async () => {
        await whenObservedHomeListSettles(queryClient);
        await finish(current);
      };
      if (!celebrate) {
        await reveal();
        return;
      }
      celebrateThen('tags', () => {
        void reveal();
      });
    } catch (err) {
      console.warn('onboarding tags save failed', err);
      setError(t('onboarding.tagsSaveError'));
    } finally {
      setBusy(false);
    }
  };

  const confirmLeave = () => {
    const prompt = leavePromptRef.current;
    if (!prompt) return;
    leavePromptRef.current = null;
    setLeavePrompt(null);
    if (prompt.id === 'notifications' || prompt.id === 'location') {
      setRejected((current) => (current === prompt.id ? null : current));
      void onSkip(prompt.id);
      return;
    }
    if (prompt.id === 'area') {
      void onSkipArea(prompt.detected ?? null);
      return;
    }
    void onSaveTags([], false);
  };

  const acknowledgeDenied = () => {
    const prompt = leavePromptRef.current;
    if (!prompt || prompt.source !== 'denied') return;
    leavePromptRef.current = null;
    setLeavePrompt(null);
    const stepIndex = STEPS.findIndex((step) => step.id === prompt.id);
    if (stepIndex >= 0 && stepIndex < STEPS.length - 1) goTo(stepIndex + 1);
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
        scrollEnabled={celebrated == null && leavePrompt == null && !awaitingDenyAlert}
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={onScrollEnd}
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

        {reached >= 1 ? (
          <StepFrame
            image={STEPS[1]!.image}
            hero={{ sf: 'bell', md: 'notifications-none' }}
            title={t('onboarding.notificationsTitle')}
            body={t('onboarding.notificationsBody')}
            bottomInset={insets.bottom}
            topInset={insets.top}
            error={error}
          >
            <PrimaryButton
              label={t('onboarding.activate')}
              loading={busy}
              confirmed={celebrated === 'notifications'}
              rejected={rejected === 'notifications'}
              onConfirmed={onCelebrated}
              onPress={() => void onActivate('notifications')}
            />
            <SkipButton
              label={t('onboarding.skip')}
              disabled={busy || celebrated != null}
              onPress={() => openLeavePrompt({ id: 'notifications', source: 'skip' })}
            />
          </StepFrame>
        ) : null}

        {reached >= 2 ? (
          <StepFrame
            image={STEPS[2]!.image}
            hero={{ sf: 'location', md: 'location-on' }}
            title={t('onboarding.locationTitle')}
            body={t('onboarding.locationBody')}
            bottomInset={insets.bottom}
            topInset={insets.top}
            error={error}
          >
            <PrimaryButton
              label={t('onboarding.activate')}
              loading={busy}
              confirmed={celebrated === 'location'}
              rejected={rejected === 'location'}
              onConfirmed={onCelebrated}
              onPress={() => void onActivate('location')}
            />
            <SkipButton
              label={t('onboarding.skip')}
              disabled={busy || celebrated != null}
              onPress={() => openLeavePrompt({ id: 'location', source: 'skip' })}
            />
          </StepFrame>
        ) : null}

        {reached >= 3 ? (
          <StepFrame
            image={STEPS[3]!.image}
            hero={{ sf: 'mappin.and.ellipse', md: 'place' }}
            title={t('onboarding.areaTitle')}
            body={
              state?.location === 'granted'
                ? t('onboarding.areaBodyLocated')
                : t('onboarding.areaBodySearch')
            }
            bottomInset={insets.bottom}
            topInset={insets.top}
            error={error}
            liftForKeyboard
          >
            <OnboardingAreaStep
              active={index === 3}
              locationGranted={state?.location === 'granted'}
              fallbackName={t('events.locationHere')}
              busy={busy}
              confirmed={celebrated === 'area'}
              onConfirmed={onCelebrated}
              onSave={(place) => {
                void onSaveArea(place);
              }}
              onSkip={(detected) => {
                openLeavePrompt({ id: 'area', source: 'skip', detected });
              }}
            />
          </StepFrame>
        ) : null}

        {reached >= 4 ? (
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
              confirmed={celebrated === 'tags'}
              onConfirmed={onCelebrated}
              onContinue={(tagIds) => {
                void onSaveTags(tagIds);
              }}
              onSkip={() => {
                openLeavePrompt({ id: 'tags', source: 'skip' });
              }}
            />
          </StepFrame>
        ) : null}
      </ScrollView>
      <ConfirmAction
        title={t(LEAVE_COPY[leavePrompt?.id ?? 'notifications'].title)}
        message={t(LEAVE_COPY[leavePrompt?.id ?? 'notifications'].message)}
        confirmLabel={t('onboarding.skipConfirm')}
        cancelLabel={t('onboarding.skipCancel')}
        isPresented={leavePrompt?.source === 'skip'}
        onIsPresentedChange={(open) => {
          if (!open) setLeavePrompt(null);
        }}
        onConfirm={confirmLeave}
      />
      <AcknowledgeAlert
        title={t(
          leavePrompt?.id === 'location'
            ? 'onboarding.deniedLocationTitle'
            : 'onboarding.deniedNotificationsTitle',
        )}
        confirmLabel={t('onboarding.deniedOk')}
        isPresented={leavePrompt?.source === 'denied'}
        onConfirm={acknowledgeDenied}
      />
    </View>
  );
}

function StepFrame({
  image,
  hero,
  title,
  body,
  accentLabel,
  accentSoft,
  bottomInset,
  topInset = 0,
  error,
  fill,
  liftForKeyboard,
  children,
}: {
  image: ImageSourcePropType;
  hero?: ButtonIcon;
  title: string;
  body: string;
  accentLabel?: string;
  accentSoft?: string;
  bottomInset: number;
  topInset?: number;
  error?: string | null;
  /** Let the step body use the space under the title, for the interest grid. */
  fill?: boolean;
  /** Shift this step up while the software keyboard is open. */
  liftForKeyboard?: boolean;
  children: ReactNode;
}) {
  const frame = (
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
      {/* <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {hero ? <HeroIcon icon={hero} /> : null}
      </View> */}
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
  );

  return (
    <View style={styles.step}>
      <Image
        pointerEvents="none"
        source={image}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      {liftForKeyboard ? <KeyboardLift bottomInset={bottomInset}>{frame}</KeyboardLift> : frame}
    </View>
  );
}

function HeroIcon({ icon }: { icon: ButtonIcon }) {
  return (
    <View pointerEvents="none" style={[styles.hero]}>
      <View style={styles.heroGlyph}>
        {process.env.EXPO_OS === 'ios' ? (
          <SymbolView name={icon.sf} size={64} tintColor="#FFFFFF" />
        ) : (
          <MaterialIcons name={icon.md} size={64} color="#FFFFFF" />
        )}
      </View>
    </View>
  );
}

/** Follows the keyboard so the place field and its suggestions stay visible. */
function KeyboardLift({ bottomInset, children }: { bottomInset: number; children: ReactNode }) {
  const keyboard = useAnimatedKeyboard();
  const style = useAnimatedStyle(() => {
    const lift = Math.max(0, keyboard.height.value - bottomInset);
    return { transform: [{ translateY: -lift }] };
  }, [bottomInset]);

  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
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
  hero: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
    alignItems: 'center',
  },
  heroGlyph: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    borderRadius: radius.xl,
    padding: space.xxl,
    backgroundColor: colors.cardOpacity,
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

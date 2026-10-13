import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { krPriceLabel } from '@local-events/domain';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmAction } from '@/components/native/confirm-action';
import { EventActionsMenu } from '@/components/native/event-actions-menu';
import { ProfilePromptSheet } from '@/components/native/profile-prompt-sheet';
import { RatingSheet } from '@/components/native/rating-sheet';
import { ReminderPicker } from '@/components/native/reminder-picker';
import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { DateBox } from '@/components/ui/date-box';
import { EventHeroGallery } from '@/components/ui/event-hero-gallery';
import { EventPlan } from '@/components/ui/event-plan';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TagPills, PricePill } from '@/components/ui/tag-pills';
import { MaxContentWidth } from '@/constants/theme';
import { getPublicEvent, listTags, namesForTagIds } from '@/lib/events';
import { eventListFreshness } from '@/lib/query-client';
import { fetchCheckInStatus, performCodeCheckIn, performGeoCheckIn } from '@/lib/check-in';
import { fetchEventContent, readCachedEventContent } from '@/lib/event-content';
import { dateBadge, primaryAction, safeHttpUrl } from '@/lib/event-format';
import { ensureIdentity } from '@/lib/identity';
import {
  clearComing,
  listComingEvents,
  listSavedEvents,
  markComing,
  saveEvent,
  unsaveEvent,
} from '@/lib/library';
import { fetchProfile, updateProfile } from '@/lib/profile';
import { fetchRatingStatus, submitRating } from '@/lib/ratings';
import { cancelEventReminder, eventReminderSlots, scheduleEventReminders } from '@/lib/reminders';
import {
  canOfferEventReminder,
  upcomingReminderSlots,
  type ReminderSlot,
} from '@/lib/reminder-times';
import { directionsUrl } from '@/lib/directions';
import { shareEventLink } from '@/lib/event-share';
import { buildEventWebUrl } from '@/lib/event-share-url';
import { reportEvent } from '@/lib/reports';
import { followTarget, listSubscriptions, unfollowTarget } from '@/lib/subscriptions';
import { fetchEventStats } from '@/lib/stats';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

export default function EventDetailScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reportOpen, setReportOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [code, setCode] = useState('');
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
    retry: 1,
  });
  const event = useQuery({
    queryKey: ['public-event', id],
    ...eventListFreshness,
    queryFn: () => getPublicEvent(id),
    enabled: typeof id === 'string' && id.length > 0,
  });
  const reminder = useQuery({
    queryKey: ['event-reminder', id],
    queryFn: () => eventReminderSlots(id!),
    enabled: typeof id === 'string' && id.length > 0,
  });
  const reminderOn = (reminder.data?.length ?? 0) > 0;
  const checkInStatus = useQuery({
    queryKey: ['check-in-status', id, identity.data?.userId],
    queryFn: () => fetchCheckInStatus(identity.data!, id!),
    enabled:
      identity.isSuccess &&
      typeof id === 'string' &&
      id.length > 0 &&
      event.data?.checkInEnabled === true,
  });
  const content = useQuery({
    queryKey: ['event-content', id, identity.data?.userId, checkInStatus.data?.checkedIn],
    queryFn: async () => {
      try {
        return await fetchEventContent(identity.data ?? null, id!);
      } catch {
        const cached = await readCachedEventContent(id!);
        if (cached) {
          return {
            items: cached.items,
            checkedIn: true,
            fromCache: true as const,
            attendeeText: cached.attendeeText,
            attendeeLinks: cached.attendeeLinks,
          };
        }
        throw new Error('content_unavailable');
      }
    },
    enabled: typeof id === 'string' && id.length > 0 && event.data?.checkInEnabled === true,
  });
  const ratingStatus = useQuery({
    queryKey: ['rating-status', id, identity.data?.userId],
    queryFn: () => fetchRatingStatus(identity.data ?? null, id!),
    enabled: typeof id === 'string' && id.length > 0,
  });
  const saved = useQuery({
    queryKey: ['saved-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listSavedEvents(identity.data!),
  });
  const isSaved = saved.data?.items.some((item) => item.id === id) ?? false;
  const coming = useQuery({
    queryKey: ['coming-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listComingEvents(identity.data!),
  });
  const isComing = coming.data?.items.some((item) => item.id === id) ?? false;
  const subscriptions = useQuery({
    queryKey: ['subscriptions', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listSubscriptions(identity.data!),
  });
  const followingPublisher =
    subscriptions.data?.items.some(
      (item) => item.targetType === 'publisher' && item.targetId === event.data?.publisherId,
    ) ?? false;
  const eventStats = useQuery({
    queryKey: ['event-stats', id],
    queryFn: () => fetchEventStats(id!),
    enabled: typeof id === 'string' && id.length > 0,
  });
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: () => listTags(),
  });
  const rate = useMutation({
    mutationFn: (input: { score: number; comment?: string | null }) =>
      submitRating(identity.data!, id!, input),
    onSuccess: async () => {
      setRatingOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['rating-status', id] });
    },
    onError: () => {
      Alert.alert(t('events.rateHowWasIt'), t('events.rateError'));
    },
  });
  const saveReminder = useMutation({
    mutationFn: async (slots: ReminderSlot[]) => {
      if (!event.data) return 'none' as const;
      return scheduleEventReminders({
        eventId: event.data.id,
        title: event.data.title,
        startsAt: event.data.startsAt,
        bodies: {
          day: t('events.remindDay'),
          hour: t('events.remindHour'),
          start: t('events.remindStart'),
        },
        slots,
      });
    },
    onSuccess: async (result) => {
      setReminderOpen(false);
      if (result === 'scheduled') {
        await queryClient.invalidateQueries({ queryKey: ['event-reminder', id] });
      }
      const message =
        result === 'scheduled'
          ? t('events.remindSet')
          : result === 'permission'
            ? t('events.remindPermission')
            : result === 'none'
              ? t('events.remindNone')
              : t('events.remindWeb');
      setReminderNotice(message);
      if (Platform.OS !== 'web' && result !== 'scheduled') {
        Alert.alert(t('events.remindMe'), message);
      }
    },
  });
  const clearReminder = useMutation({
    mutationFn: async () => {
      if (!event.data) return;
      await cancelEventReminder(event.data.id);
    },
    onSuccess: async () => {
      setReminderOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['event-reminder', id] });
      setReminderNotice(t('events.remindCleared'));
    },
  });

  function openReminderPicker() {
    if (!event.data) return;
    if (!canOfferEventReminder(new Date(event.data.startsAt), new Date())) return;
    const upcoming = upcomingReminderSlots(new Date(event.data.startsAt), new Date());
    if (upcoming.length === 0) {
      setReminderNotice(t('events.remindNone'));
      if (Platform.OS !== 'web') Alert.alert(t('events.remindMe'), t('events.remindNone'));
      return;
    }
    setReminderOpen(true);
  }

  const reminderOptions = useMemo(() => {
    if (!event.data || !reminderOpen) return [];
    const labels = {
      day: t('events.remindDayOption'),
      hour: t('events.remindHourOption'),
      start: t('events.remindStartOption'),
    } as const;
    return upcomingReminderSlots(new Date(event.data.startsAt), new Date()).map((slot) => ({
      slot: slot.slot,
      label: labels[slot.slot],
    }));
  }, [event.data, reminderOpen, t]);
  async function afterCheckIn() {
    await queryClient.invalidateQueries({ queryKey: ['check-in-status', id] });
    await queryClient.invalidateQueries({ queryKey: ['my-check-ins'] });
    await queryClient.invalidateQueries({ queryKey: ['event-content', id] });
    const current = await queryClient.fetchQuery({
      queryKey: ['profile', identity.data?.userId],
      queryFn: () => fetchProfile(identity.data!),
    });
    if (!current.profileChosen) setProfileOpen(true);
  }

  const checkIn = useMutation({
    mutationFn: () => performGeoCheckIn(identity.data!, id!),
    onSuccess: () => {
      void afterCheckIn();
    },
    onError: (err: Error) => {
      const message =
        err.message === 'location_permission_denied'
          ? t('events.checkInPermission')
          : t('events.checkInError');
      Alert.alert(t('events.checkIn'), message);
    },
  });
  const codeCheckIn = useMutation({
    mutationFn: () => performCodeCheckIn(identity.data!, id!, code),
    onSuccess: () => {
      setCode('');
      void afterCheckIn();
    },
    onError: () => {
      Alert.alert(t('events.checkIn'), t('events.checkInCodeError'));
    },
  });
  const saveProfile = useMutation({
    mutationFn: (input: {
      choice: 'named' | 'anonymous';
      displayName?: string;
      recoveryEmail?: string | null;
    }) => updateProfile(identity.data!, input),
    onSuccess: async () => {
      setProfileOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: () => {
      Alert.alert(t('events.profilePromptTitle'), t('events.profileSaveError'));
    },
  });

  function toggleSaved() {
    if (!identity.data || typeof id !== 'string') return;
    void (isSaved ? unsaveEvent(identity.data, id) : saveEvent(identity.data, id))
      .then(() => queryClient.invalidateQueries({ queryKey: ['saved-events'] }))
      .catch(() => Alert.alert(t('events.planTitle'), t('events.planError')));
  }

  function toggleComing() {
    if (!identity.data || typeof id !== 'string') return;
    void (isComing ? clearComing(identity.data, id) : markComing(identity.data, id))
      .then(() => queryClient.invalidateQueries({ queryKey: ['coming-events'] }))
      .catch(() => Alert.alert(t('events.planTitle'), t('events.planError')));
  }

  function toggleFollow() {
    if (!identity.data || !event.data) return;
    const publisherId = event.data.publisherId;
    const next = followingPublisher
      ? unfollowTarget(identity.data, 'publisher', publisherId)
      : followTarget(identity.data, 'publisher', publisherId);
    void next
      .then(() => queryClient.invalidateQueries({ queryKey: ['subscriptions'] }))
      .catch(() => Alert.alert(t('events.organizer'), t('events.followError')));
  }

  async function submitReport() {
    if (typeof id !== 'string') return;
    try {
      const who = identity.data ?? (await ensureIdentity(locale));
      await reportEvent(who, id);
      Alert.alert(t('events.reportTitle'), t('events.reportSent'));
    } catch {
      Alert.alert(t('events.reportTitle'), t('events.reportError'));
    }
  }

  async function openDirections() {
    const location = event.data?.location;
    if (!location) return;
    try {
      await Linking.openURL(directionsUrl(location.lat, location.lng, Platform.OS));
    } catch {
      Alert.alert(t('events.directions'), t('events.directionsError'));
    }
  }

  async function shareEvent() {
    if (!event.data || typeof id !== 'string') return;
    try {
      const result = await shareEventLink({ title: event.data.title, eventId: id });
      if (result === 'copied') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(t('events.share'), t('events.linkCopied'));
      }
    } catch {
      Alert.alert(t('events.share'), t('events.shareLinkError'));
    }
  }

  async function copyLink() {
    if (typeof id !== 'string') return;
    try {
      await Clipboard.setStringAsync(buildEventWebUrl(id));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert(t('events.copyLink'), t('events.shareLinkError'));
    }
  }

  const priceLabel = krPriceLabel(event.data?.priceAmount);
  const offerReminder = event.data
    ? canOfferEventReminder(new Date(event.data.startsAt), new Date())
    : false;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <ScrollView
        style={{
          flex: 1,
          width: '100%',
          maxWidth: MaxContentWidth,
          backgroundColor: colors.canvas,
        }}
        directionalLockEnabled
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: Math.max(insets.bottom, space.xl),
        }}
      >
        <View style={{ height: 400, backgroundColor: colors.accentSoft }}>
          {event.data ? (
            <EventHeroGallery
              imageUrl={event.data.imageUrl}
              imageUrls={event.data.imageUrls}
              tags={namesForTagIds(event.data.tagIds, tags.data?.items)}
            />
          ) : null}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: 120,
              experimental_backgroundImage:
                'linear-gradient(to bottom, rgba(20,20,20,0.38) 0%, rgba(20,20,20,0) 100%)',
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: insets.top + space.sm,
              left: space.lg,
            }}
          >
            <BackPill />
          </View>
          {event.data ? (
            <View
              style={{
                position: 'absolute',
                top: insets.top + space.sm,
                right: space.lg,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
              }}
            >
              <CircleIconButton
                tintColor={isSaved ? (colors.accent as string) : undefined}
                sf={isSaved ? 'heart.fill' : 'heart'}
                md={isSaved ? 'favorite' : 'favorite-border'}
                accessibilityLabel={isSaved ? t('events.unfavorite') : t('events.favorite')}
                onPress={toggleSaved}
              />
              <CircleIconButton
                sf="arrowshape.turn.up.right"
                md="shortcut"
                iconSize={22}
                accessibilityLabel={t('events.share')}
                onPress={() => void shareEvent()}
              />
            </View>
          ) : null}
        </View>

        {event.data ? (
          <View
            style={{
              marginTop: -100,
              paddingHorizontal: space.xl,
              zIndex: 2,
              alignSelf: 'flex-start',
            }}
          >
            <DateBox shadow={true} badge={dateBadge(event.data.startsAt, locale)} />
          </View>
        ) : null}

        <View
          style={{
            flexGrow: 1,
            backgroundColor: colors.canvas,
            marginTop: event.data ? -space.xxl : 0,
            zIndex: 1,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            borderCurve: 'continuous',
            overflow: 'hidden',
          }}
        >
          {event.isPending && <AppText variant="caption">{t('events.loading')}</AppText>}
          {event.isError && (
            <AppText variant="caption" style={{ color: colors.danger }}>
              {t('events.loadError')}
            </AppText>
          )}
          {event.data && (
            <>
              <View
                style={{
                  flexGrow: 1,
                  backgroundColor: colors.canvas,
                  borderTopLeftRadius: radius.lg,
                  borderTopRightRadius: radius.lg,
                  borderCurve: 'continuous',
                  gap: space.lg,
                  paddingTop: 36,
                  paddingBottom: space.xxl,
                }}
              >
                <View style={{
                  paddingHorizontal: space.lg,
                  borderBottomColor: colors.separator,
                  borderBottomWidth: 1,
                  paddingBottom: space.lg,
                  gap: space.sm,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
                    <View style={{ flex: 1 }}>
                      <AppText
                        style={{
                          fontSize: 22,
                          lineHeight: 28,
                          fontWeight: '700',
                          color: colors.ink,
                          paddingRight: priceLabel ? 64 : 0,
                        }}
                      >
                        {event.data.title}
                      </AppText>
                      {priceLabel ? (
                        <View pointerEvents="none" style={{ position: 'absolute', top: 4, right: 0 }}>
                          <PricePill label={priceLabel} />
                        </View>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <EventActionsMenu
                        accessibilityLabel={t('events.moreActions')}
                        interestedLabel={
                          isSaved ? t('events.removeInterest') : t('events.saveInterested')
                        }
                        interestedOn={isSaved}
                        onInterested={toggleSaved}
                        comingLabel={isComing ? t('events.removeComing') : t('events.planComing')}
                        comingOn={isComing}
                        onComing={toggleComing}
                        shareLabel={t('events.share')}
                        copyLinkLabel={t('events.copyLink')}
                        reportLabel={t('events.report')}
                        onShare={() => void shareEvent()}
                        onCopyLink={() => void copyLink()}
                        onReport={() => setReportOpen(true)}
                        directionsLabel={
                          event.data.mode === 'physical' && event.data.location
                            ? t('events.directions')
                            : undefined
                        }
                        onDirections={
                          event.data.mode === 'physical' && event.data.location
                            ? () => void openDirections()
                            : undefined
                        }
                        followLabel={
                          event.data.publisherName
                            ? t(
                                followingPublisher
                                  ? 'events.unfollowPublisher'
                                  : 'events.followPublisher',
                                { name: event.data.publisherName },
                              )
                            : undefined
                        }
                        following={followingPublisher}
                        onFollow={event.data.publisherName ? toggleFollow : undefined}
                        remindLabel={
                          offerReminder
                            ? reminderOn
                              ? t('events.remindMeOn')
                              : t('events.remindMe')
                            : undefined
                        }
                        onRemind={offerReminder ? openReminderPicker : undefined}
                        buttonStyle={{ 
                          width: 42, 
                          height: 42, 
                          backgroundColor: colors.card,
                          borderRadius: radius.pill,
                        }}
                      />
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <DetailIcon
                      sf={event.data.mode === 'physical' ? 'mappin' : 'link'}
                      md={event.data.mode === 'physical' ? 'location-on' : 'link'}
                    />
                    <AppText variant="body" style={{ flex: 1, color: colors.ink }}>
                      {event.data.mode === 'physical'
                        ? [event.data.venueName, event.data.publisherName]
                          .filter(Boolean)
                          .join(' · ') || t('events.missingVenue')
                        : (event.data.onlineUrl ?? event.data.publisherName)}
                    </AppText>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flex: 1 }}
                    >
                      <DetailIcon sf="calendar" md="event" />
                      <AppText variant="caption" style={{ color: colors.ink, flexShrink: 1 }}>
                        {new Date(event.data.startsAt).toLocaleDateString(locale, {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </AppText>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                      <DetailIcon sf="clock" md="schedule" />
                      <AppText variant="caption" style={{ color: colors.ink }}>
                        {`${new Date(event.data.startsAt).toLocaleTimeString(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })} – ${new Date(event.data.endsAt).toLocaleTimeString(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`}
                      </AppText>
                    </View>
                  </View>


                </View>

                <View style={{
                  paddingHorizontal: space.lg, gap: space.lg,
                }}>

                  <TagPills tags={namesForTagIds(event.data.tagIds, tags.data?.items)} />

                  {event.data.description ? (
                    <AppText variant="body" style={{ color: colors.ink }}>
                      {event.data.description}
                    </AppText>
                  ) : null}

                </View>

                <EventPlan
                  title={t('events.planTitle')}
                  interestedLabel={t('events.planInterested')}
                  comingLabel={t('events.planComing')}
                  hint={t('events.planHint')}
                  interested={isSaved}
                  coming={isComing}
                  onInterestedPress={toggleSaved}
                  onComingPress={toggleComing}
                />

                <View style={{
                  paddingHorizontal: space.lg, gap: space.lg,
                }}>

                  {(() => {
                    const action = primaryAction(event.data.links, event.data.onlineUrl);
                    const url = action ? safeHttpUrl(action.url) : null;
                    if (!action || !url) return null;
                    const label =
                      action.label ??
                      (action.kind === 'tickets'
                        ? t('events.linkTickets')
                        : action.kind === 'registration'
                          ? t('events.linkRegistration')
                          : action.kind === 'online'
                            ? t('events.linkOnline')
                            : t('events.linkInfo'));
                    return <PrimaryButton label={label} onPress={() => void Linking.openURL(url)} />;
                  })()}

                  {event.data.checkInEnabled ? (
                    <View style={{ gap: space.sm }}>
                      <AppText variant="subtitle">{t('events.contentTitle')}</AppText>
                      {'fromCache' in (content.data ?? {}) &&
                        (content.data as { fromCache?: boolean }).fromCache ? (
                        <AppText variant="caption">{t('events.contentCached')}</AppText>
                      ) : null}
                      {content.isPending && (
                        <AppText variant="caption">{t('events.loading')}</AppText>
                      )}
                      {content.data && !content.data.checkedIn ? (
                        <AppText variant="caption">{t('events.contentLocked')}</AppText>
                      ) : null}
                      {content.data?.checkedIn && content.data.attendeeText ? (
                        <AppText variant="body">{content.data.attendeeText}</AppText>
                      ) : null}
                      {content.data?.checkedIn
                        ? content.data.attendeeLinks.map((link) => (
                          <PrimaryButton
                            key={link.id}
                            label={link.label || t('events.linkInfo')}
                            onPress={() => void Linking.openURL(link.url)}
                          />
                        ))
                        : null}
                      {content.data?.items.map((item) => (
                        <View key={item.id} style={{ gap: 4 }}>
                          <AppText variant="subtitle">{item.title}</AppText>
                          {item.body ? <AppText variant="body">{item.body}</AppText> : null}
                          {item.url ? (
                            <AppText variant="caption" style={{ color: colors.accent }}>
                              {item.url}
                            </AppText>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {eventStats.data &&
                    (eventStats.data.numCheckins > 0 || eventStats.data.numRatings > 0) ? (
                    <View style={{ gap: space.xs }}>
                      {eventStats.data.numCheckins > 0 ? (
                        <AppText variant="caption">
                          {t('events.statsCheckIns', { count: eventStats.data.numCheckins })}
                        </AppText>
                      ) : null}
                      {eventStats.data.numRatings > 0 ? (
                        <AppText variant="caption">
                          {t('events.statsRatings', {
                            average: eventStats.data.ratingAverage ?? '–',
                            count: eventStats.data.numRatings,
                          })}
                        </AppText>
                      ) : null}
                    </View>
                  ) : ratingStatus.data?.aggregate.count ? (
                    <AppText variant="caption">
                      {t('events.rateAggregate', {
                        average: ratingStatus.data.aggregate.average ?? '–',
                        count: ratingStatus.data.aggregate.count,
                      })}
                    </AppText>
                  ) : null}

                  {ratingStatus.data?.canRate ? (
                    <PrimaryButton
                      label={t('events.rateHowWasIt')}
                      onPress={() => setRatingOpen(true)}
                    />
                  ) : ratingStatus.data?.hasRated ? (
                    <PrimaryButton label={t('events.rateDone')} disabled />
                  ) : !event.data.checkInEnabled ? null : checkInStatus.data?.checkedIn ? (
                    <PrimaryButton label={t('events.checkInDone')} disabled />
                  ) : event.data.mode === 'physical' ? (
                    <View style={{ gap: space.md }}>
                      <PrimaryButton
                        label={
                          checkInStatus.isError
                            ? t('events.checkInError')
                            : checkInStatus.isLoading
                              ? t('events.loading')
                              : checkInStatus.data?.open
                                ? t('events.checkIn')
                                : t('events.checkInClosed')
                        }
                        loading={checkIn.isPending || checkInStatus.isLoading}
                        disabled={
                          checkInStatus.isError || !checkInStatus.data?.open || !identity.data
                        }
                        onPress={() => checkIn.mutate()}
                      />
                      {checkInStatus.data?.codeActive && checkInStatus.data.open ? (
                        <CodeCheckInFields
                          code={code}
                          onChangeCode={setCode}
                          loading={codeCheckIn.isPending}
                          disabled={!identity.data}
                          onSubmit={() => codeCheckIn.mutate()}
                          hint={t('events.checkInCodeHint')}
                          placeholder={t('events.checkInCodePlaceholder')}
                          submitLabel={t('events.checkInWithCode')}
                        />
                      ) : null}
                    </View>
                  ) : checkInStatus.data?.codeActive && checkInStatus.data.open ? (
                    <CodeCheckInFields
                      code={code}
                      onChangeCode={setCode}
                      loading={codeCheckIn.isPending}
                      disabled={!identity.data}
                      onSubmit={() => codeCheckIn.mutate()}
                      hint={t('events.checkInCodeHint')}
                      placeholder={t('events.checkInCodePlaceholder')}
                      submitLabel={t('events.checkInWithCode')}
                    />
                  ) : null}
                  {reminderNotice ? <AppText variant="caption">{reminderNotice}</AppText> : null}
                </View>



              </View>
            </>
          )}
        </View>
      </ScrollView>

      <ConfirmAction
        title={t('events.reportTitle')}
        message={t('events.reportMessage')}
        confirmLabel={t('events.reportConfirm')}
        cancelLabel={t('events.cancel')}
        isPresented={reportOpen}
        onIsPresentedChange={setReportOpen}
        onConfirm={() => {
          setReportOpen(false);
          void submitReport();
        }}
      />

      <ProfilePromptSheet
        isPresented={profileOpen}
        onDismiss={() => setProfileOpen(false)}
        title={t('events.profilePromptTitle')}
        body={t('events.profilePromptBody')}
        nameLabel={t('events.profileNameLabel')}
        namePlaceholder={t('events.profileNamePlaceholder')}
        emailLabel={t('events.profileEmailLabel')}
        emailPlaceholder={t('events.profileEmailPlaceholder')}
        saveNamedLabel={t('events.profileSaveNamed')}
        stayAnonymousLabel={t('events.profileStayAnonymous')}
        saving={saveProfile.isPending}
        onSaveNamed={(displayName, recoveryEmail) =>
          saveProfile.mutate({
            choice: 'named',
            displayName,
            recoveryEmail: recoveryEmail || null,
          })
        }
        onStayAnonymous={(recoveryEmail) =>
          saveProfile.mutate({
            choice: 'anonymous',
            recoveryEmail: recoveryEmail || null,
          })
        }
      />

      <ReminderPicker
        isPresented={reminderOpen}
        onDismiss={() => setReminderOpen(false)}
        title={t('events.remindMe')}
        body={t('events.remindChoose')}
        options={reminderOptions}
        activeSlots={reminder.data ?? []}
        saveLabel={t('events.remindSave')}
        clearLabel={t('events.remindClear')}
        saving={saveReminder.isPending || clearReminder.isPending}
        onSave={(slots) => saveReminder.mutate(slots)}
        onClear={reminderOn ? () => clearReminder.mutate() : undefined}
      />

      <RatingSheet
        isPresented={ratingOpen}
        onDismiss={() => setRatingOpen(false)}
        title={t('events.rateHowWasIt')}
        body={t('events.rateBody')}
        commentLabel={t('events.rateCommentLabel')}
        commentPlaceholder={t('events.rateCommentPlaceholder')}
        submitLabel={t('events.rateSubmit')}
        saving={rate.isPending}
        onSubmit={(score, comment) => rate.mutate({ score, comment: comment || null })}
      />
    </View>
  );
}

function CodeCheckInFields({
  code,
  onChangeCode,
  loading,
  disabled,
  onSubmit,
  hint,
  placeholder,
  submitLabel,
}: {
  code: string;
  onChangeCode: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  hint: string;
  placeholder: string;
  submitLabel: string;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="caption">{hint}</AppText>
      <TextInput
        value={code}
        onChangeText={(v) =>
          onChangeCode(
            v
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '')
              .slice(0, 8),
          )
        }
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="characters"
        autoCorrect={false}
        style={{
          backgroundColor: colors.canvas,
          borderRadius: radius.md,
          borderCurve: 'continuous',
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          fontSize: 18,
          letterSpacing: 4,
          color: colors.ink,
          textAlign: 'center',
        }}
      />
      <PrimaryButton
        label={submitLabel}
        loading={loading}
        disabled={disabled || code.trim().length < 4}
        onPress={onSubmit}
      />
    </View>
  );
}

function DetailIcon({ sf, md }: { sf: string; md: keyof typeof MaterialIcons.glyphMap }) {
  return process.env.EXPO_OS === 'ios' ? (
    <SymbolView name={sf as never} size={16} tintColor={colors.inkMuted} />
  ) : (
    <MaterialIcons name={md} size={16} color={colors.inkMuted} />
  );
}

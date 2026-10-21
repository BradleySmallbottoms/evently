import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { krPriceLabel } from '@local-events/domain';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmAction } from '@/components/native/confirm-action';
import { ProfilePromptSheet } from '@/components/native/profile-prompt-sheet';
import { RatingSheet } from '@/components/native/rating-sheet';
import { ReminderPicker } from '@/components/native/reminder-picker';
import { AppText } from '@/components/ui/app-text';
import { EventHeroGallery } from '@/components/ui/event-hero-gallery';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { PrimaryButton } from '@/components/ui/primary-button';
import { MaxContentWidth } from '@/constants/theme';
import {
  FALLBACK_CENTER,
  getPublicEvent,
  listOccasionEvents,
  listPublicEvents,
  listTags,
  namesForTagIds,
} from '@/lib/events';
import { eventListFreshness } from '@/lib/query-client';
import { fetchCheckInStatus, performCodeCheckIn, performGeoCheckIn } from '@/lib/check-in';
import { fetchEventContent, readCachedEventContent } from '@/lib/event-content';
import {
  descriptionParts,
  formatDayHeading,
  formatPeriod,
  formatTimeRange,
  isOpenPeriod,
  linkHost,
  periodStatus,
} from '@/lib/event-detail-format';
import { primaryAction, safeHttpUrl } from '@/lib/event-format';
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
import { isWholeDay, upcomingSpanOccasions } from '@/lib/span-occasions';
import { shareEventLink } from '@/lib/event-share';
import { buildEventWebUrl } from '@/lib/event-share-url';
import { reportEvent } from '@/lib/reports';
import { followTarget, listSubscriptions, unfollowTarget } from '@/lib/subscriptions';
import { fetchEventStats } from '@/lib/stats';
import { DetailCard } from './_components/detail-card';
import { DetailGlyph, IconTile } from './_components/detail-glyph';
import { DetailMap } from './_components/detail-map';
import { GoodToKnow, type FactRow } from './_components/good-to-know';
import { HowItWorks } from './_components/how-it-works';
import { OccasionPeriod } from './_components/occasion-period';
import { ParticipateBar } from './_components/participate-bar';
import { RelatedEvents } from './_components/related-events';
import { ShareRow } from './_components/share-row';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

export default function EventDetailScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reportOpen, setReportOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [code, setCode] = useState('');
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** Local on/off until the saved and coming lists catch up. */
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null);
  const [comingOverride, setComingOverride] = useState<boolean | null>(null);
  /** Added to the server totals until that query returns a new count. */
  const [savedDelta, setSavedDelta] = useState(0);
  const [comingDelta, setComingDelta] = useState(0);
  /** Save state for similar events until the saved list catches up. */
  const [relatedSaved, setRelatedSaved] = useState<Record<string, boolean>>({});

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
  const serverSaved = event.data?.numSaved;
  const serverComing = event.data?.numComing;
  const [countedSaved, setCountedSaved] = useState(serverSaved);
  const [countedComing, setCountedComing] = useState(serverComing);
  if (serverSaved !== countedSaved) {
    setCountedSaved(serverSaved);
    setSavedDelta(0);
  }
  if (serverComing !== countedComing) {
    setCountedComing(serverComing);
    setComingDelta(0);
  }
  const occasionGroupId = event.data?.meta.occasionGroupId;
  const occasions = useQuery({
    queryKey: ['event-occasions', occasionGroupId],
    ...eventListFreshness,
    queryFn: () => listOccasionEvents(occasionGroupId!),
    enabled: typeof occasionGroupId === 'string' && occasionGroupId.length > 0,
  });
  const otherOccasions = useMemo(() => {
    const folded = upcomingSpanOccasions(
      event.data?.meta.occasions,
      new Date(),
      event.data?.timezone,
    ).map((occasion, index) => ({
      key: `${occasion.startsAt}-${index}`,
      startsAt: occasion.startsAt,
      endsAt: occasion.endsAt ?? null,
      venueName: occasion.venueName ?? event.data?.venueName ?? null,
      publisherName: event.data?.publisherName ?? '',
    }));
    const siblings = (occasions.data?.items ?? [])
      .filter((item) => item.id !== id)
      .map((item) => ({
        key: item.id,
        eventId: item.id,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        venueName: item.venueName,
        publisherName: item.publisherName,
      }));
    return [...folded, ...siblings];
  }, [event.data, occasions.data?.items, id]);
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
  const interestedOn = savedOverride ?? isSaved;
  const coming = useQuery({
    queryKey: ['coming-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listComingEvents(identity.data!),
  });
  const isComing = coming.data?.items.some((item) => item.id === id) ?? false;
  const comingOn = comingOverride ?? isComing;
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
  const primaryTagId = event.data?.tagIds[0];
  const relatedPoint = event.data?.location
    ? { lat: event.data.location.lat, lng: event.data.location.lng, radiusM: 50_000 }
    : FALLBACK_CENTER;
  const related = useQuery({
    queryKey: ['related-events', id, primaryTagId, relatedPoint.lat, relatedPoint.lng],
    ...eventListFreshness,
    queryFn: () =>
      listPublicEvents(relatedPoint, { tagId: primaryTagId, limit: 8, sort: 'soonest' }),
    enabled: Boolean(event.data && primaryTagId),
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
    const on = savedOverride ?? isSaved;
    const next = !on;
    setSavedOverride(next);
    setSavedDelta((count) => count + (next ? 1 : -1));
    void (on ? unsaveEvent(identity.data, id) : saveEvent(identity.data, id))
      .then(() => queryClient.invalidateQueries({ queryKey: ['saved-events'] }))
      .catch(() => {
        setSavedOverride(on);
        setSavedDelta((count) => count + (next ? -1 : 1));
        Alert.alert(t('events.planTitle'), t('events.planError'));
      });
  }

  function toggleComing() {
    if (!identity.data || typeof id !== 'string') return;
    const on = comingOverride ?? isComing;
    const next = !on;
    setComingOverride(next);
    setComingDelta((count) => count + (next ? 1 : -1));
    void (on ? clearComing(identity.data, id) : markComing(identity.data, id))
      .then(() => queryClient.invalidateQueries({ queryKey: ['coming-events'] }))
      .catch(() => {
        setComingOverride(on);
        setComingDelta((count) => count + (next ? -1 : 1));
        Alert.alert(t('events.planTitle'), t('events.planError'));
      });
  }

  async function refreshDetail() {
    setRefreshing(true);
    try {
      const jobs: Promise<unknown>[] = [
        event.refetch(),
        eventStats.refetch(),
        ratingStatus.refetch(),
        reminder.refetch(),
        tags.refetch(),
        ...(occasionGroupId ? [occasions.refetch()] : []),
        ...(event.data?.tagIds[0] ? [related.refetch()] : []),
      ];
      if (identity.isSuccess) {
        jobs.push(identity.refetch(), saved.refetch(), coming.refetch(), subscriptions.refetch());
      }
      if (event.data?.checkInEnabled) {
        jobs.push(checkInStatus.refetch(), content.refetch());
      }
      await Promise.all(jobs);
      setSavedOverride(null);
      setComingOverride(null);
      setSavedDelta(0);
      setComingDelta(0);
      setRelatedSaved({});
    } finally {
      setRefreshing(false);
    }
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

  async function openDirections(location?: { lat: number; lng: number } | null) {
    if (!location) return;
    try {
      await Linking.openURL(
        directionsUrl(location.lat, location.lng, Platform.OS, event.data?.meta.address),
      );
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

  async function shareFacebook() {
    if (typeof id !== 'string') return;
    const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(buildEventWebUrl(id))}`;
    try {
      await WebBrowser.openBrowserAsync(shareUrl);
    } catch {
      Alert.alert(t('events.share'), t('events.shareLinkError'));
    }
  }

  function toggleRelatedSaved(eventId: string, on: boolean) {
    if (!identity.data) return;
    const next = !on;
    setRelatedSaved((current) => ({ ...current, [eventId]: next }));
    void (on ? unsaveEvent(identity.data, eventId) : saveEvent(identity.data, eventId))
      .then(() => queryClient.invalidateQueries({ queryKey: ['saved-events'] }))
      .catch(() => {
        setRelatedSaved((current) => ({ ...current, [eventId]: on }));
        Alert.alert(t('events.planTitle'), t('events.planError'));
      });
  }

  const offerReminder = event.data
    ? canOfferEventReminder(new Date(event.data.startsAt), new Date())
    : false;
  const timeZone = event.data?.timezone;
  const multiDay = event.data
    ? isOpenPeriod(event.data.startsAt, event.data.endsAt, timeZone)
    : false;
  const copy = descriptionParts(event.data?.description, event.data?.summary);
  const tagNames = namesForTagIds(event.data?.tagIds ?? [], tags.data?.items);
  const interestCount = Math.max(0, (event.data?.numSaved ?? 0) + savedDelta);
  const comingCount = Math.max(0, (event.data?.numComing ?? 0) + comingDelta);
  const mapPoints = useMemo(() => {
    if (!event.data) return [];
    const points: { lat: number; lng: number }[] = [];
    const seen = new Set<string>();
    const add = (location?: { lat: number; lng: number } | null) => {
      if (!location) return;
      const key = `${location.lat.toFixed(5)},${location.lng.toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      points.push({ lat: location.lat, lng: location.lng });
    };
    add(event.data.location);
    for (const occasion of event.data.meta.occasions ?? []) add(occasion.location);
    for (const item of occasions.data?.items ?? []) {
      if (item.id !== id) add(item.location);
    }
    return points;
  }, [event.data, occasions.data?.items, id]);
  const relatedItems = useMemo(() => {
    return (related.data?.items ?? [])
      .filter((item) => item.id !== id)
      .slice(0, 3)
      .map((item) => ({
        id: item.id,
        title: item.title,
        when: formatPeriod(item.startsAt, item.endsAt, locale, item.timezone),
        where: item.venueName || item.publisherName,
        imageUrl: item.imageUrl,
        tags: namesForTagIds(item.tagIds, tags.data?.items),
        saved:
          relatedSaved[item.id] ??
          saved.data?.items.some((savedItem) => savedItem.id === item.id) ??
          false,
      }));
  }, [related.data?.items, id, locale, tags.data?.items, relatedSaved, saved.data?.items]);

  const whenTitle = event.data
    ? multiDay
      ? formatPeriod(event.data.startsAt, event.data.endsAt, locale, timeZone)
      : formatDayHeading(event.data.startsAt, locale, timeZone)
    : '';
  const whenSubtitle = event.data
    ? multiDay
      ? t('events.detail.joinWhenYouWant')
      : isWholeDay(event.data.startsAt, event.data.endsAt)
        ? t('events.wholeDay')
        : formatTimeRange(event.data.startsAt, event.data.endsAt, locale, timeZone)
    : '';
  const socialLabel =
    interestCount > 0
      ? t('events.detail.interestCount', { count: interestCount })
      : comingCount > 0
        ? t('events.detail.comingCount', { count: comingCount })
        : null;
  const facts: FactRow[] = [];
  if (event.data) {
    const link = primaryAction(event.data.links, event.data.onlineUrl);
    const linkUrl = link ? safeHttpUrl(link.url) : null;
    facts.push({
      key: 'type',
      sf: event.data.mode === 'physical' ? 'mappin.and.ellipse' : 'link',
      md: event.data.mode === 'physical' ? 'place' : 'link',
      label: t('events.detail.knowType'),
      value:
        event.data.mode === 'physical'
          ? t(multiDay ? 'events.detail.typeInPersonPeriod' : 'events.detail.typeInPerson')
          : t(multiDay ? 'events.detail.typeOnlinePeriod' : 'events.detail.typeOnline'),
    });
    facts.push({
      key: 'place',
      sf: 'mappin',
      md: 'place',
      label: t('events.detail.knowPlace'),
      value:
        event.data.mode === 'physical'
          ? event.data.venueName || t('events.missingVenue')
          : t('events.online'),
    });
    if (event.data.priceAmount === 0) {
      facts.push({
        key: 'cost',
        sf: 'creditcard',
        md: 'payments',
        label: t('events.detail.knowCost'),
        value: t('events.detail.costFree'),
      });
    } else if ((event.data.priceAmount ?? 0) > 0) {
      const price = krPriceLabel(event.data.priceAmount);
      if (price) {
        facts.push({
          key: 'cost',
          sf: 'creditcard',
          md: 'payments',
          label: t('events.detail.knowCost'),
          value: price,
        });
      }
    }
    if (link && linkUrl) {
      facts.push({
        key: 'more',
        sf: 'info.circle',
        md: 'info-outline',
        label: t('events.detail.knowMore'),
        value: link.label || linkHost(linkUrl) || t('events.linkInfo'),
        accent: true,
        onPress: () => {
          void Linking.openURL(linkUrl);
        },
      });
    }
    if (offerReminder) {
      facts.push({
        key: 'remind',
        sf: 'bell',
        md: 'notifications-none',
        label: t('events.detail.knowRemind'),
        value: reminderOn ? t('events.remindMeOn') : t('events.remindMe'),
        onPress: openReminderPicker,
      });
    }
  }
  const showOccasions = Boolean(event.data) && (multiDay || otherOccasions.length > 0);
  const status = event.data
    ? periodStatus(event.data.startsAt, event.data.endsAt, new Date(), timeZone)
    : 'soon';
  const aboutLong = copy.about.length > 280;
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <View style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth }}>
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.canvas }}
          directionalLockEnabled
          contentInsetAdjustmentBehavior="never"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void refreshDetail();
              }}
              tintColor={colors.accent}
              progressViewOffset={insets.top}
            />
          }
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: 128 + insets.bottom,
          }}
        >
          <View style={{ height: 300, backgroundColor: colors.accentSoft }}>
            {event.data ? (
              <EventHeroGallery
                imageUrl={event.data.imageUrl}
                imageUrls={event.data.imageUrls}
                tags={tagNames}
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
                zIndex: 2,
              }}
            >
              <CircleIconButton
                sf="chevron.left"
                md="arrow-back"
                accessibilityLabel={t('events.back')}
                onPress={() => router.back()}
              />
            </View>
            {event.data ? (
              <View
                style={{
                  position: 'absolute',
                  top: insets.top + space.sm,
                  right: space.lg,
                  zIndex: 2,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                }}
              >
                <CircleIconButton
                  tintColor={interestedOn ? (colors.accent as string) : undefined}
                  sf={interestedOn ? 'heart.fill' : 'heart'}
                  md={interestedOn ? 'favorite' : 'favorite-border'}
                  accessibilityLabel={interestedOn ? t('events.unfavorite') : t('events.favorite')}
                  onPress={toggleSaved}
                />
                <CircleIconButton
                  sf="square.and.arrow.up"
                  md="share"
                  accessibilityLabel={t('events.share')}
                  onPress={() => void shareEvent()}
                />
              </View>
            ) : null}
          </View>

          <View
            style={{
              marginTop: -space.lg,
              backgroundColor: colors.canvas,
              paddingTop: space.lg,
              gap: space.lg,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
            }}
          >
            {event.isPending ? <AppText variant="caption">{t('events.loading')}</AppText> : null}
            {event.isError ? (
              <AppText variant="caption" style={{ color: colors.danger }}>
                {t('events.loadError')}
              </AppText>
            ) : null}

            {event.data ? (
              <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
                <View
                  style={{
                    flexDirection: 'row',
                    gap: space.sm,
                  }}
                >
                  {tagNames.map((tag) => (
                    <View
                      key={tag}
                      style={{
                        backgroundColor: colors.secondarySoft,
                        borderRadius: radius.pill,
                        boxShadow: shadow.soft,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.xs,
                        paddingHorizontal: space.xs,
                        paddingVertical: space.xs,
                      }}
                    >
                      <DetailGlyph sf="leaf" md="eco" size={14} color={colors.success as string} />
                      <AppText
                        numberOfLines={1}
                        style={{
                          color: colors.success,
                          fontSize: 12,
                          lineHeight: 16,
                          fontWeight: '700',
                          letterSpacing: 0.6,
                          textTransform: 'uppercase',
                        }}
                      >
                        {tag}
                      </AppText>
                    </View>
                  ))}
                </View>

                <View style={{ gap: space.sm }}>
                  {event.data.meta.fromUserTip ? (
                    <AppText
                      variant="caption"
                      style={{
                        alignSelf: 'flex-start',
                        color: colors.ink,
                        backgroundColor: colors.accentSoft,
                        borderRadius: radius.pill,
                        overflow: 'hidden',
                        paddingHorizontal: space.sm,
                        paddingVertical: 4,
                      }}
                    >
                      {t('tips.fromUser')}
                    </AppText>
                  ) : null}
                  <AppText
                    style={{ fontSize: 28, lineHeight: 34, fontWeight: '700', color: colors.ink }}
                  >
                    {event.data.title}
                  </AppText>
                  {copy.lead ? (
                    <AppText style={{ fontSize: 16, lineHeight: 23, color: colors.inkMuted }}>
                      {copy.lead}
                    </AppText>
                  ) : null}
                </View>

                <DetailCard>
                  <View style={{ gap: space.lg }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        minHeight: 44,
                      }}
                    >
                      <DetailGlyph
                        sf="calendar"
                        md="event"
                        size={32}
                        color={colors.accent as string}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText style={{ fontSize: 16, lineHeight: 22, fontWeight: '700' }}>
                          {whenTitle}
                        </AppText>
                        <AppText variant="caption">{whenSubtitle}</AppText>
                      </View>
                    </View>

                    <Pressable
                      accessibilityRole={mapPoints.length > 0 ? 'button' : undefined}
                      disabled={mapPoints.length === 0}
                      onPress={() => void openDirections(mapPoints[0])}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        minHeight: 44,
                      }}
                    >
                      <DetailGlyph
                        sf={event.data.mode === 'physical' ? 'location.fill' : 'link'}
                        md={event.data.mode === 'physical' ? 'location-on' : 'link'}
                        size={32}
                        color={colors.accent as string}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText style={{ fontSize: 16, lineHeight: 22, fontWeight: '700' }}>
                          {event.data.mode === 'physical'
                            ? event.data.venueName || t('events.missingVenue')
                            : t('events.online')}
                        </AppText>
                        <AppText variant="caption">
                          {[
                            event.data.publisherName,
                            mapPoints.length > 0 ? t('events.detail.showMap') : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </AppText>
                      </View>
                      {mapPoints.length > 0 ? (
                        <DetailGlyph
                          sf="chevron.right"
                          md="chevron-right"
                          size={18}
                          color={colors.inkMuted as string}
                        />
                      ) : null}
                    </Pressable>
                  </View>
                </DetailCard>

                {socialLabel ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <DetailGlyph
                      sf="person.2"
                      md="people"
                      size={18}
                      color={colors.inkMuted as string}
                    />
                    <AppText style={{ fontSize: 14, lineHeight: 20, color: colors.ink }}>
                      {socialLabel}
                    </AppText>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* <View style={{ gap: space.lg, paddingHorizontal: space.lg }}>
              <PrimaryButton
                label={comingOn ? t('events.detail.joined') : t('events.detail.join')}
                onPress={toggleComing}
                color={comingOn ? (colors.primary as string) : undefined}
                labelColor={comingOn ? '#FFFFFF' : undefined}
                icon={{
                  sf: comingOn ? 'checkmark.circle.fill' : 'checkmark.circle',
                  md: comingOn ? 'check-circle' : 'check-circle-outline',
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: interestedOn }}
                onPress={toggleSaved}
                style={{
                  minHeight: 44,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: space.sm,
                  borderWidth: 1,
                  borderColor: interestedOn ? colors.accent : colors.ink,
                  borderRadius: radius.md,
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                }}
              >
                <DetailGlyph
                  sf={interestedOn ? 'heart.fill' : 'heart'}
                  md={interestedOn ? 'favorite' : 'favorite-border'}
                  color={interestedOn ? (colors.accent as string) : (colors.ink as string)}
                />
                <AppText
                  style={{
                    fontSize: 16,
                    lineHeight: 22,
                    fontWeight: '700',
                    color: interestedOn ? colors.accent : colors.ink,
                  }}
                >
                  {t('events.planInterested')}
                </AppText>
              </Pressable>
            </View> */}

            {event.data ? (
              <View
                style={{
                  paddingHorizontal: space.lg,
                  gap: space.lg,
                  backgroundColor: colors.cardDarkest,
                  paddingTop: space.lg,
                }}
              >
                {copy.about ? (
                  <View style={{ gap: space.sm }}>
                    <AppText style={{ fontSize: 20, lineHeight: 26, fontWeight: '700' }}>
                      {t('events.detail.about')}
                    </AppText>
                    <AppText variant="body" numberOfLines={aboutOpen || !aboutLong ? undefined : 4}>
                      {copy.about}
                    </AppText>
                    {aboutLong ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setAboutOpen((open) => !open)}
                        style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
                      >
                        <AppText
                          style={{
                            color: colors.info,
                            fontSize: 15,
                            lineHeight: 20,
                            fontWeight: '700',
                          }}
                        >
                          {aboutOpen
                            ? t('events.detail.readLess')
                            : `${t('events.detail.readMore')} ↓`}
                        </AppText>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {(event.data.meta.instructions ?? []).length > 0 ? (
                  <DetailCard>
                    <HowItWorks steps={event.data.meta.instructions ?? []} />
                  </DetailCard>
                ) : null}

                <DetailMap
                  points={mapPoints}
                  openLabel={t('events.detail.showMap')}
                  onOpen={() => void openDirections(mapPoints[0])}
                />

                {event.data.publisherName ? (
                  <DetailCard>
                    <View style={{ gap: space.md }}>
                      <AppText style={{ fontSize: 20, lineHeight: 26, fontWeight: '700' }}>
                        {t('events.organizer')}
                      </AppText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                        <View
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: radius.md,
                            borderCurve: 'continuous',
                            backgroundColor: colors.secondarySoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <AppText
                            style={{
                              fontSize: 20,
                              lineHeight: 24,
                              fontWeight: '700',
                              color: colors.secondary,
                            }}
                          >
                            {event.data.publisherName.trim().charAt(0).toUpperCase()}
                          </AppText>
                        </View>
                        <AppText
                          style={{ flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '700' }}
                        >
                          {event.data.publisherName}
                        </AppText>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected: followingPublisher }}
                          onPress={toggleFollow}
                          style={{
                            minHeight: 44,
                            justifyContent: 'center',
                            paddingHorizontal: space.sm,
                          }}
                        >
                          <AppText
                            style={{
                              color: colors.info,
                              fontSize: 15,
                              lineHeight: 20,
                              fontWeight: '700',
                            }}
                          >
                            {followingPublisher
                              ? t('events.detail.following')
                              : t('events.detail.follow')}
                          </AppText>
                        </Pressable>
                      </View>
                    </View>
                  </DetailCard>
                ) : null}

                {facts.length > 0 || reminderNotice ? (
                  <DetailCard>
                    <View style={{ gap: space.md }}>
                      <GoodToKnow title={t('events.detail.knowTitle')} rows={facts} />
                      {reminderNotice ? (
                        <AppText variant="caption">{reminderNotice}</AppText>
                      ) : null}
                    </View>
                  </DetailCard>
                ) : null}

                {event.data.checkInEnabled ? (
                  <DetailCard>
                    <View style={{ gap: space.sm }}>
                      <AppText style={{ fontSize: 20, lineHeight: 26, fontWeight: '700' }}>
                        {t('events.contentTitle')}
                      </AppText>
                      {'fromCache' in (content.data ?? {}) &&
                      (content.data as { fromCache?: boolean }).fromCache ? (
                        <AppText variant="caption">{t('events.contentCached')}</AppText>
                      ) : null}
                      {content.isPending ? (
                        <AppText variant="caption">{t('events.loading')}</AppText>
                      ) : null}
                      {content.data && !content.data.checkedIn ? (
                        <AppText variant="caption">{t('events.contentLocked')}</AppText>
                      ) : null}
                      {content.data?.checkedIn && content.data.attendeeText ? (
                        <AppText variant="body">{content.data.attendeeText}</AppText>
                      ) : null}
                      {content.data?.checkedIn
                        ? content.data.attendeeLinks.map((link) => {
                            const url = safeHttpUrl(link.url);
                            if (!url) return null;
                            return (
                              <PrimaryButton
                                key={link.id}
                                label={link.label || t('events.linkInfo')}
                                onPress={() => void Linking.openURL(url)}
                              />
                            );
                          })
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
                  </DetailCard>
                ) : null}

                {eventStats.data &&
                (eventStats.data.numCheckins > 0 || eventStats.data.numRatings > 0) ? (
                  <DetailCard>
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
                  </DetailCard>
                ) : ratingStatus.data?.aggregate.count ? (
                  <DetailCard>
                    <AppText variant="caption">
                      {t('events.rateAggregate', {
                        average: ratingStatus.data.aggregate.average ?? '–',
                        count: ratingStatus.data.aggregate.count,
                      })}
                    </AppText>
                  </DetailCard>
                ) : null}

                {ratingStatus.data?.canRate ||
                ratingStatus.data?.hasRated ||
                event.data.checkInEnabled ? (
                  <DetailCard>
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
                  </DetailCard>
                ) : null}

                {showOccasions ? (
                  <DetailCard>
                    <OccasionPeriod
                      title={t('events.detail.allOccasions')}
                      infoLabel={t('events.detail.whenCanIJoin')}
                      rangeLabel={t('events.detail.ongoingRange', { range: whenTitle })}
                      badgeLabel={
                        status === 'now'
                          ? t('events.detail.happeningNow')
                          : status === 'soon'
                            ? t('events.detail.upcoming')
                            : t('events.detail.ended')
                      }
                      badgeTone={status}
                      hint={t('events.detail.pickYourDay')}
                      showDatesLabel={t('events.detail.showDates')}
                      hideDatesLabel={t('events.detail.hideDates')}
                      items={otherOccasions}
                      locale={locale}
                      timeZone={timeZone ?? undefined}
                      missingVenue={t('events.missingVenue')}
                    />
                  </DetailCard>
                ) : null}

                <RelatedEvents
                  title={t('events.detail.similar')}
                  seeAllLabel={t('events.seeAll')}
                  onSeeAll={
                    primaryTagId
                      ? () =>
                          router.push({
                            pathname: '/event-search',
                            params: { tagId: primaryTagId, tagAt: String(Date.now()) },
                          })
                      : undefined
                  }
                  items={relatedItems}
                  savedLabel={t('events.unfavorite')}
                  unsavedLabel={t('events.favorite')}
                  onPress={(eventId) => router.push(`/events/${eventId}`)}
                  onSave={toggleRelatedSaved}
                />

                <DetailCard>
                  <ShareRow
                    title={t('events.detail.shareSection')}
                    actions={[
                      {
                        key: 'copy',
                        label: t('events.copyLink'),
                        sf: 'link',
                        md: 'link',
                        onPress: () => void copyLink(),
                      },
                      {
                        key: 'facebook',
                        label: t('events.detail.shareFacebook'),
                        letter: 'f',
                        onPress: () => void shareFacebook(),
                      },
                      {
                        key: 'instagram',
                        label: t('events.detail.shareInstagram'),
                        sf: 'camera',
                        md: 'photo-camera',
                        onPress: () => void shareEvent(),
                      },
                      {
                        key: 'more',
                        label: t('events.detail.shareMore'),
                        sf: 'square.and.arrow.up',
                        md: 'share',
                        onPress: () => void shareEvent(),
                      },
                    ]}
                  />
                </DetailCard>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => setReportOpen(true)}
                  style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <AppText variant="caption">{t('events.report')}</AppText>
                </Pressable>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {event.data ? (
          <ParticipateBar
            title={event.data.title}
            when={whenTitle}
            imageUrl={event.data.imageUrl}
            tags={tagNames}
            joinLabel={comingOn ? t('events.detail.joined') : t('events.detail.join')}
            joined={comingOn}
            onJoin={toggleComing}
          />
        ) : null}
      </View>

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

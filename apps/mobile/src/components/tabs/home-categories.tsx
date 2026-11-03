import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useQueries } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { CategoryFiltersSheet } from '@/components/native/category-filters-sheet';
import { AppText } from '@/components/ui/app-text';
import { EventImage } from '@/components/ui/event-image';
import { TAG_GROUP_STYLE, TagGroupIcon, TagGroupList } from '@/components/ui/tag-group-list';
import { eventPlaceLabel, relativeDateLabel } from '@/lib/event-format';
import { listPublicEvents, namesForTagIds, type EventQueryPoint } from '@/lib/events';
import { eventListFreshness } from '@/lib/query-client';
import { shownWhen } from '@/lib/span-occasions';
import {
  groupHomeTags,
  groupsToShow,
  homeTagSelectionForEdit,
  homeTagSelectionIsEveryTag,
  homeTagSelectionToStore,
  tagIdsForGroup,
  type HomeTag,
  type HomeTagGroupId,
} from '@/lib/tag-groups';
import { useEventCount } from '@/lib/use-event-count';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { DatePill } from './date-pill';

type RailEvent = {
  id: string;
  title: string;
  when: string;
  where: string;
  imageUrl?: string | null;
  tags: string[];
  saved: boolean;
};

type Props = {
  tags: HomeTag[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  point?: EventQueryPoint;
  locale: string;
  savedIds: ReadonlySet<string>;
  onToggleSave: (eventId: string) => void;
  onOpen: (eventId: string) => void;
  onShowAll: (tagIds: string[]) => void;
};

const CARD_WIDTH = 168;

function tap() {
  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
}

function CategoryCard({
  item,
  onOpen,
  onToggleSave,
}: {
  item: RailEvent;
  onOpen: () => void;
  onToggleSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ width: CARD_WIDTH, gap: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.when}`}
        onPress={onOpen}
        style={{
          height: 168,
          borderRadius: radius.md,
          borderCurve: 'continuous',
          overflow: 'hidden',
          backgroundColor: colors.accentSoft,
        }}
      >
        <EventImage
          imageUrl={item.imageUrl}
          tags={item.tags}
          eventId={item.id}
          style={{ width: '100%', height: '100%' }}
        />
        <View
          pointerEvents="none"
          style={{ position: 'absolute', bottom: space.sm, left: space.sm, right: 40 }}
        >
          <DatePill label={item.when} />
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.saved ? t('explore.saved') : t('explore.save')}
        onPress={() => {
          tap();
          onToggleSave();
        }}
        style={{
          position: 'absolute',
          top: space.sm,
          right: space.sm,
          width: 32,
          height: 32,
          borderRadius: radius.pill,
          backgroundColor: 'rgba(255,255,255,0.92)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {process.env.EXPO_OS === 'ios' ? (
          <SymbolView
            name={item.saved ? 'heart.fill' : 'heart'}
            size={16}
            tintColor={item.saved ? colors.danger : colors.ink}
          />
        ) : (
          <MaterialIcons
            name={item.saved ? 'favorite' : 'favorite-border'}
            size={16}
            color={item.saved ? colors.danger : colors.ink}
          />
        )}
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onOpen} style={{ gap: 2 }}>
        <AppText numberOfLines={2} style={{ fontSize: 15, lineHeight: 19, fontWeight: '700' }}>
          {item.title}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {item.where}
        </AppText>
      </Pressable>
    </View>
  );
}

export function HomeCategories({
  tags,
  selectedIds,
  onChange,
  point,
  locale,
  savedIds,
  onToggleSave,
  onOpen,
  onShowAll,
}: Props) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<{ group: HomeTagGroupId | null; token: number } | null>(
    null,
  );
  const groups = useMemo(() => groupHomeTags(tags), [tags]);
  const shown = useMemo(() => groupsToShow(groups, selectedIds), [groups, selectedIds]);
  const allTagIds = useMemo(() => tags.map((tag) => tag.id), [tags]);
  const sheetSelection = useMemo(
    () => homeTagSelectionForEdit(allTagIds, selectedIds),
    [allTagIds, selectedIds],
  );
  const eventCount = useEventCount(
    point,
    {
      tagIds: selectedIds.length > 0 ? [...selectedIds] : undefined,
      // A home row keeps an event only when its first tag is selected.
      primaryTag: selectedIds.length > 0,
    },
    editor != null && point != null,
  );
  const rails = useQueries({
    queries: shown.map((group) => {
      const tagIds = tagIdsForGroup(group, selectedIds);
      return {
        queryKey: [
          'category-rail',
          'primary-tag',
          point?.lat,
          point?.lng,
          point?.radiusM,
          group.id,
          tagIds.join(','),
        ],
        enabled: point != null && tagIds.length > 0,
        queryFn: () =>
          listPublicEvents(point!, {
            tagIds,
            primaryTag: true,
            sort: 'soonest',
            limit: 12,
          }),
        ...eventListFreshness,
      };
    }),
  });

  function openEditor(group: HomeTagGroupId | null) {
    tap();
    setEditor({ group, token: Date.now() });
  }

  return (
    <View style={{ gap: space.xl }}>
      {shown.map((group, index) => {
        const query = rails[index];
        const tagIds = tagIdsForGroup(group, selectedIds);
        const groupTagIds = new Set(tagIds);
        const now = new Date();
        // The list is already limited to the first tag. This drops a card whose
        // first tag still belongs to another row.
        const items: RailEvent[] = (query?.data?.items ?? [])
          .filter((item) => {
            const first = item.tagIds[0];
            return first != null && groupTagIds.has(first);
          })
          .map((item) => {
            const when = shownWhen(item, now);
            return {
              id: item.id,
              title: item.title,
              when: relativeDateLabel(
                when.startsAt,
                locale,
                { today: t('events.dateToday'), tomorrow: t('events.dateTomorrow') },
                now,
                item.timezone,
              ),
              where: eventPlaceLabel({
                mode: item.mode,
                venueName: item.venueName,
                city: item.meta?.address?.city,
                onlineUrl: item.onlineUrl,
                missingVenue: t('events.missingVenue'),
                missingUrl: t('events.missingUrl'),
              }),
              imageUrl: item.imageUrl,
              tags: namesForTagIds(item.tagIds, tags),
              saved: savedIds.has(item.id),
            };
          });
        return (
          <CategoryRow
            key={group.id}
            id={group.id}
            loading={query?.isPending === true && items.length === 0}
            failed={query?.isError === true}
            items={items}
            onShowAll={() => onShowAll(tagIds)}
            onEdit={() => openEditor(group.id)}
            onOpen={onOpen}
            onToggleSave={onToggleSave}
          />
        );
      })}

      {shown.length < groups.length ? (
        <View style={{ alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.addCategories')}
            onPress={() => openEditor(null)}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: colors.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {process.env.EXPO_OS === 'ios' ? (
              <SymbolView name="plus" size={22} tintColor={colors.card} />
            ) : (
              <MaterialIcons name="add" size={24} color={colors.card} />
            )}
          </Pressable>
        </View>
      ) : null}

      <CategoryFiltersSheet
        isPresented={editor != null}
        onDismiss={() => setEditor(null)}
        eventCount={eventCount}
      >
        <TagGroupList
          key={editor?.token ?? 0}
          tags={tags}
          selectedIds={sheetSelection}
          initialExpandedId={editor?.group ?? null}
          showClear={!homeTagSelectionIsEveryTag(allTagIds, sheetSelection)}
          onChange={(ids) => onChange(homeTagSelectionToStore(allTagIds, ids))}
        />
      </CategoryFiltersSheet>
    </View>
  );
}

function CategoryRow({
  id,
  loading,
  failed,
  items,
  onShowAll,
  onEdit,
  onOpen,
  onToggleSave,
}: {
  id: HomeTagGroupId;
  loading: boolean;
  failed: boolean;
  items: RailEvent[];
  onShowAll: () => void;
  onEdit: () => void;
  onOpen: (eventId: string) => void;
  onToggleSave: (eventId: string) => void;
}) {
  const { t } = useTranslation();
  const style = TAG_GROUP_STYLE[id];
  const label = t(`events.tagGroup.${id}`);
  return (
    <View style={{ gap: space.md }}>
      <View
        style={{
          paddingHorizontal: space.xl,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: style.fill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <TagGroupIcon id={id} size={36} />
        </View>
        <AppText style={{ fontSize: 18, lineHeight: 24, fontWeight: '700' }}>{label}</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.editCategory', { category: label })}
          onPress={onEdit}
          hitSlop={8}
          style={{
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {process.env.EXPO_OS === 'ios' ? (
            <SymbolView name="pencil" size={16} tintColor={colors.inkMuted} />
          ) : (
            <MaterialIcons name="edit" size={16} color={colors.inkMuted} />
          )}
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('events.viewAll')}, ${label}`}
          onPress={onShowAll}
          style={{
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <AppText variant="label" style={{ color: '#8A5A3A', fontWeight: '700' }}>
            {t('events.viewAll')}
          </AppText>
          <MaterialIcons name="chevron-right" size={18} color="#8A5A3A" />
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.ink} style={{ marginVertical: space.md }} />
      ) : failed ? (
        <AppText variant="caption" style={{ paddingHorizontal: space.xl, color: colors.danger }}>
          {t('events.loadError')}
        </AppText>
      ) : items.length === 0 ? (
        <AppText variant="caption" style={{ paddingHorizontal: space.xl }}>
          {t('home.categoryEmpty')}
        </AppText>
      ) : (
        <FlatList
          horizontal
          nestedScrollEnabled
          data={items}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.md, paddingHorizontal: space.xl }}
          renderItem={({ item }) => (
            <CategoryCard
              item={item}
              onOpen={() => onOpen(item.id)}
              onToggleSave={() => onToggleSave(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

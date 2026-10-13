import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import {
  groupHomeTags,
  toggleGroupSelection,
  toggleTagSelection,
  type HomeTag,
  type HomeTagGroupId,
} from '@/lib/tag-groups';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Icon = { sf: SFSymbol; md: keyof typeof MaterialIcons.glyphMap };

const GROUP_STYLE: Record<HomeTagGroupId, Icon & { fill: string; icon: string }> = {
  music: { sf: 'music.note', md: 'music-note', fill: '#F8E6D8', icon: '#8A5A3A' },
  sport: { sf: 'figure.run', md: 'directions-run', fill: '#E4EFEA', icon: '#3E6B58' },
  culture: { sf: 'building.columns', md: 'museum', fill: '#E3EBF3', icon: '#3E5F78' },
  family: { sf: 'figure.and.child.holdinghands', md: 'child-care', fill: '#F6E4E2', icon: '#8A4E48' },
  holiday: { sf: 'gift', md: 'card-giftcard', fill: '#F3EBD4', icon: '#7A6840' },
  other: { sf: 'tag', md: 'label', fill: '#E7E4F2', icon: '#5C5278' },
};

type Props = {
  tags: HomeTag[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
};

function tap() {
  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
}

function GroupIcon({ id, size }: { id: HomeTagGroupId; size: number }) {
  const style = GROUP_STYLE[id];
  const glyph = Math.round(size * 0.4);
  return process.env.EXPO_OS === 'ios' ? (
    <SymbolView name={style.sf} size={glyph} tintColor={style.icon} />
  ) : (
    <MaterialIcons name={style.md} size={glyph} color={style.icon} />
  );
}

/** Group circles, then an expandable list where each group opens its tags. */
export function TagFilters({ tags, selectedIds, onChange }: Props) {
  const { t } = useTranslation();
  const [listOpen, setListOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<HomeTagGroupId | null>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const groups = useMemo(() => groupHomeTags(tags), [tags]);

  if (groups.length === 0) return null;

  return (
    <View style={{ gap: space.md }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.xs, paddingHorizontal: space.xl }}
      >
        {groups.map((group) => {
          const style = GROUP_STYLE[group.id];
          const chosen = group.tags.filter((tag) => selected.has(tag.id)).length;
          return (
            <Pressable
              key={group.id}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen > 0 }}
              accessibilityLabel={t(`events.tagGroup.${group.id}`)}
              onPress={() => {
                tap();
                onChange(
                  toggleGroupSelection(
                    selectedIds,
                    group.tags.map((tag) => tag.id),
                  ),
                );
              }}
              style={{ width: 76, alignItems: 'center', gap: space.xs }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: style.fill,
                  borderWidth: chosen > 0 ? 2 : 0,
                  borderColor: style.icon,
                }}
              >
                <GroupIcon id={group.id} size={64} />
              </View>
              <AppText
                numberOfLines={2}
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  lineHeight: 15,
                  fontWeight: '600',
                  color: colors.ink,
                }}
              >
                {t(`events.tagGroup.${group.id}`)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: listOpen }}
        onPress={() => {
          tap();
          setListOpen((open) => !open);
        }}
        style={{
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.accent,
          backgroundColor: colors.accentSoft,
          marginTop: space.sm,
        }}
      >
        <AppText variant="label" style={{ color: colors.accentDeep }}>
          {listOpen ? t('events.tagGroupsHide') : t('events.tagGroupsShowAll')}
        </AppText>
        {process.env.EXPO_OS === 'ios' ? (
          <SymbolView
            name={listOpen ? 'chevron.up' : 'chevron.down'}
            size={14}
            tintColor={colors.accent}
          />
        ) : (
          <MaterialIcons
            name={listOpen ? 'expand-less' : 'expand-more'}
            size={18}
            color={colors.accent}
          />
        )}
      </Pressable>

      {listOpen ? (
        <View style={{ paddingHorizontal: space.xl, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText variant="subtitle">{t('events.tagGroupsTitle')}</AppText>
            {selectedIds.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  tap();
                  onChange([]);
                }}
                hitSlop={8}
              >
                <AppText variant="label" style={{ color: colors.accent }}>
                  {t('events.tagGroupsClear')}
                </AppText>
              </Pressable>
            ) : null}
          </View>
          {groups.map((group) => {
            const style = GROUP_STYLE[group.id];
            const open = expandedId === group.id;
            const chosen = group.tags.filter((tag) => selected.has(tag.id)).length;
            return (
              <View
                key={group.id}
                style={{
                  backgroundColor: colors.card,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.line,
                  padding: space.md,
                  gap: space.md,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => {
                    tap();
                    setExpandedId(open ? null : group.id);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: style.fill,
                    }}
                  >
                    <GroupIcon id={group.id} size={40} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText style={{ fontSize: 16, lineHeight: 20, fontWeight: '700' }}>
                      {t(`events.tagGroup.${group.id}`)}
                    </AppText>
                    <AppText variant="caption">
                      {t('events.tagGroupCount', { count: group.tags.length })}
                    </AppText>
                  </View>
                  {chosen > 0 ? (
                    <View
                      style={{
                        backgroundColor: style.fill,
                        borderRadius: radius.pill,
                        paddingHorizontal: space.sm,
                        paddingVertical: 4,
                      }}
                    >
                      <AppText variant="label" style={{ color: style.icon }}>
                        {t('events.tagGroupSelected', { count: chosen })}
                      </AppText>
                    </View>
                  ) : null}
                  {process.env.EXPO_OS === 'ios' ? (
                    <SymbolView
                      name={open ? 'chevron.up' : 'chevron.down'}
                      size={16}
                      tintColor={colors.inkMuted}
                    />
                  ) : (
                    <MaterialIcons
                      name={open ? 'expand-less' : 'expand-more'}
                      size={22}
                      color={colors.inkMuted}
                    />
                  )}
                </Pressable>
                {open ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {group.tags.map((tag) => {
                      const on = selected.has(tag.id);
                      return (
                        <Pressable
                          key={tag.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={tag.name}
                          onPress={() => {
                            tap();
                            onChange(toggleTagSelection(selectedIds, tag.id));
                          }}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: space.xs,
                            paddingHorizontal: space.md,
                            paddingVertical: space.sm,
                            borderRadius: radius.pill,
                            borderWidth: 1,
                            borderColor: on ? style.icon : colors.line,
                            backgroundColor: on ? style.fill : colors.card,
                          }}
                        >
                          {on ? (
                            process.env.EXPO_OS === 'ios' ? (
                              <SymbolView name="checkmark" size={14} tintColor={style.icon} />
                            ) : (
                              <MaterialIcons name="check" size={16} color={style.icon} />
                            )
                          ) : null}
                          <AppText style={{ fontSize: 14, lineHeight: 18, fontWeight: '600' }}>{tag.name}</AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

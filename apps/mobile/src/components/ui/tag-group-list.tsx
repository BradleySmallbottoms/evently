import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import {
  groupHomeTags,
  toggleGroupSelection,
  toggleTagSelection,
  type HomeTag,
  type HomeTagGroupId,
} from '@/lib/tag-groups';
import { categoryColors, colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Icon = { sf: SFSymbol; md: keyof typeof MaterialIcons.glyphMap };

const TAG_GROUP_CATEGORY = {
  music: 'music',
  sport: 'sports',
  culture: 'culture',
  family: 'family',
  holiday: 'holidays',
  other: 'other',
} as const satisfies Record<HomeTagGroupId, keyof typeof categoryColors>;

const TAG_GROUP_ICON: Record<HomeTagGroupId, Icon> = {
  music: { sf: 'music.note', md: 'music-note' },
  sport: { sf: 'figure.run', md: 'directions-run' },
  culture: { sf: 'building.columns', md: 'museum' },
  family: { sf: 'figure.and.child.holdinghands', md: 'child-care' },
  holiday: { sf: 'gift', md: 'card-giftcard' },
  other: { sf: 'tag', md: 'label' },
};

/** Icon plus the live category tint. `fill` and `icon` follow the appearance. */
export const TAG_GROUP_STYLE: Record<HomeTagGroupId, Icon & { fill: string; icon: string }> =
  Object.fromEntries(
    (Object.keys(TAG_GROUP_ICON) as HomeTagGroupId[]).map((id) => [
      id,
      {
        ...TAG_GROUP_ICON[id],
        get fill() {
          return categoryColors[TAG_GROUP_CATEGORY[id]].fill;
        },
        get icon() {
          return categoryColors[TAG_GROUP_CATEGORY[id]].icon;
        },
      },
    ]),
  ) as Record<HomeTagGroupId, Icon & { fill: string; icon: string }>;

type Props = {
  title?: string;
  tags: HomeTag[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  /** Home shows the “Categories” heading. The settings screen uses its own title. */
  showHeading?: boolean;
  /** Group to open when this list is shown. */
  initialExpandedId?: HomeTagGroupId | null;
  /** Home hides Clear once every tag is on, because that selection is already empty. */
  showClear?: boolean;
};

function tap() {
  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
}

export function TagGroupIcon({ id, size }: { id: HomeTagGroupId; size: number }) {
  const style = TAG_GROUP_STYLE[id];
  const glyph = Math.round(size * 0.4);
  return process.env.EXPO_OS === 'ios' ? (
    <SymbolView name={style.sf} size={glyph} tintColor={style.icon} />
  ) : (
    <MaterialIcons name={style.md} size={glyph} color={style.icon} />
  );
}

/** Category groups. A tap selects or clears every tag. More opens the individual tags. */
export function TagGroupList({
  title,
  tags,
  selectedIds,
  onChange,
  showHeading = true,
  initialExpandedId = null,
  showClear = true,
}: Props) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<HomeTagGroupId | null>(initialExpandedId);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const groups = useMemo(() => groupHomeTags(tags), [tags]);

  if (groups.length === 0) return null;

  return (
    <View style={{ gap: space.sm }}>
      {showHeading || selectedIds.length > 0 ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          {showHeading ? (
            <AppText variant="subtitle">{t('events.tagGroupsTitle')}</AppText>
          ) : (
            <View />
          )}
          {showClear && selectedIds.length > 0 ? (
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
      ) : null}
      {groups.map((group) => {
        const style = TAG_GROUP_STYLE[group.id];
        const open = expandedId === group.id;
        const ids = group.tags.map((tag) => tag.id);
        const chosen = ids.filter((id) => selected.has(id)).length;
        const allOn = chosen === ids.length;
        const name = t(`events.tagGroup.${group.id}`);
        return (
          <View
            key={group.id}
            style={{
              backgroundColor: allOn ? style.fill : colors.card,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: allOn ? style.icon : colors.line,
              padding: space.md,
              gap: space.md,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: allOn }}
                accessibilityLabel={name}
                onPress={() => {
                  tap();
                  onChange(toggleGroupSelection(selectedIds, ids));
                }}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: allOn ? colors.card : style.fill,
                  }}
                >
                  <TagGroupIcon id={group.id} size={40} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText style={{ fontSize: 16, lineHeight: 20, fontWeight: '700' }}>
                    {name}
                  </AppText>
                  <AppText variant="caption">
                    {t('events.tagGroupCount', { count: group.tags.length })}
                  </AppText>
                </View>
                {chosen > 0 ? (
                  <View
                    style={{
                      backgroundColor: allOn ? colors.card : style.fill,
                      borderRadius: radius.pill,
                      paddingHorizontal: space.sm,
                      paddingVertical: 4,
                    }}
                  >
                    <AppText variant="label" style={{ color: style.icon }}>
                      {t('events.tagGroupSelected', { count: chosen, total: ids.length })}
                    </AppText>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${open ? t('events.categoriesFewer') : t('events.categoriesMore')}, ${name}`}
                onPress={() => {
                  tap();
                  setExpandedId(open ? null : group.id);
                }}
                hitSlop={8}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.line,
                }}
              >
                {process.env.EXPO_OS === 'ios' ? (
                  <SymbolView
                    name={open ? 'chevron.up' : 'chevron.down'}
                    size={14}
                    tintColor={colors.ink}
                  />
                ) : (
                  <MaterialIcons
                    name={open ? 'expand-less' : 'expand-more'}
                    size={18}
                    color={colors.ink}
                  />
                )}
              </Pressable>
            </View>
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
                        backgroundColor: on && !allOn ? style.fill : colors.card,
                      }}
                    >
                      {on ? (
                        process.env.EXPO_OS === 'ios' ? (
                          <SymbolView name="checkmark" size={14} tintColor={style.icon} />
                        ) : (
                          <MaterialIcons name="check" size={16} color={style.icon} />
                        )
                      ) : null}
                      <AppText style={{ fontSize: 14, lineHeight: 18, fontWeight: '600' }}>
                        {tag.name}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

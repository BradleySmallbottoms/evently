import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { TAG_GROUP_STYLE, TagGroupIcon, TagGroupList } from '@/components/ui/tag-group-list';
import { groupHomeTags, toggleGroupSelection, type HomeTag } from '@/lib/tag-groups';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  tags: HomeTag[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
};

function tap() {
  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
}

/** Group circles, then an expandable list where each group opens its tags. */
export function TagFilters({ tags, selectedIds, onChange }: Props) {
  const { t } = useTranslation();
  const [listOpen, setListOpen] = useState(false);
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
          const style = TAG_GROUP_STYLE[group.id];
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
                <TagGroupIcon id={group.id} size={64} />
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
        <View style={{ paddingHorizontal: space.xl }}>
          <TagGroupList tags={tags} selectedIds={selectedIds} onChange={onChange} />
        </View>
      ) : null}
    </View>
  );
}

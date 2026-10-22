import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { CategoryFiltersSheet } from '@/components/native/category-filters-sheet';
import { AppText } from '@/components/ui/app-text';
import { TAG_GROUP_STYLE, TagGroupIcon, TagGroupList } from '@/components/ui/tag-group-list';
import {
  groupHomeTags,
  toggleGroupSelection,
  type HomeTag,
  type HomeTagGroup,
} from '@/lib/tag-groups';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Props = {
  tags: HomeTag[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
};

const CELL = 55;
const CIRCLE = 48;

function tap() {
  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
}

function GroupCircle({
  group,
  selectedIds,
  onChange,
  flexCell,
}: {
  group: HomeTagGroup;
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  flexCell?: boolean;
}) {
  const { t } = useTranslation();
  const style = TAG_GROUP_STYLE[group.id];
  const chosen = group.tags.filter((tag) => selectedIds.includes(tag.id)).length;
  return (
    <Pressable
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
      style={{
        width: flexCell ? '33.33%' : CELL,
        alignItems: 'center',
        gap: space.xs,
        paddingVertical: flexCell ? space.xs : 0,
      }}
    >
      <View
        style={{
          width: CIRCLE,
          height: CIRCLE,
          borderRadius: CIRCLE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: style.fill,
          borderWidth: chosen > 0 ? 2 : 0,
          borderColor: style.icon,
        }}
      >
        <TagGroupIcon id={group.id} size={CIRCLE} />
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
}

function ToggleCircle({
  label,
  expanded,
  onPress,
  flexCell,
}: {
  label: string;
  expanded: boolean;
  onPress: () => void;
  flexCell?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: flexCell ? '33.33%' : CELL,
        alignItems: 'center',
        gap: space.xs,
        paddingVertical: flexCell ? space.xs : 0,
      }}
    >
      <View
        style={{
          width: CIRCLE,
          height: CIRCLE,
          borderRadius: CIRCLE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        {process.env.EXPO_OS === 'ios' ? (
          <SymbolView
            name={(expanded ? 'xmark' : 'ellipsis') as never}
            size={18}
            tintColor={colors.ink}
          />
        ) : (
          <MaterialIcons name={expanded ? 'close' : 'more-horiz'} size={22} color={colors.ink} />
        )}
      </View>
      <AppText
        numberOfLines={1}
        style={{
          textAlign: 'center',
          fontSize: 12,
          lineHeight: 15,
          fontWeight: '600',
          color: colors.ink,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

/** Category circles. More stays pinned and opens the tag list in a sheet. */
export function TagFilters({ tags, selectedIds, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupHomeTags(tags), [tags]);

  if (groups.length === 0) return null;

  function openSheet() {
    tap();
    setOpen(true);
  }

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1, minWidth: 0 }}
          contentContainerStyle={{ paddingLeft: space.md, paddingRight: space.md }}
        >
          {groups.map((group) => (
            <GroupCircle
              key={group.id}
              group={group}
              selectedIds={selectedIds}
              onChange={onChange}
            />
          ))}
        </ScrollView>
        <View style={{ paddingRight: space.md }}>
          <ToggleCircle label={t('events.categoriesMore')} expanded={false} onPress={openSheet} />
        </View>
      </View>
      <CategoryFiltersSheet isPresented={open} onDismiss={() => setOpen(false)}>
        <TagGroupList tags={tags} selectedIds={selectedIds} onChange={onChange} />
      </CategoryFiltersSheet>
    </>
  );
}

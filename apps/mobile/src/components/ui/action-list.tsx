import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, ScrollView, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { swipeDeleteColor, swipeEditColor, type ActionListItem } from './action-list-model';

export type { ActionListItem };

const ACTION_WIDTH = 84;

/**
 * Grouped rows for Android and web. A left swipe reveals delete, and edit when the row can change.
 */
export function ActionList({
  items,
  editLabel,
  deleteLabel,
}: {
  items: readonly ActionListItem[];
  editLabel: string;
  deleteLabel: string;
}) {
  if (items.length === 0) return null;
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: space.xl,
        paddingTop: space.md,
        paddingBottom: space.xxxl,
      }}
    >
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colors.line,
          overflow: 'hidden',
        }}
      >
        {items.map((item, index) => (
          <ActionRow
            key={item.id}
            item={item}
            editLabel={editLabel}
            deleteLabel={deleteLabel}
            last={index === items.length - 1}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function ActionRow({
  item,
  editLabel,
  deleteLabel,
  last,
}: {
  item: ActionListItem;
  editLabel: string;
  deleteLabel: string;
  last: boolean;
}) {
  const label = item.subtitle ? `${item.title}, ${item.subtitle}` : item.title;
  return (
    <Swipeable
      friction={2}
      overshootRight={false}
      renderRightActions={() => (
        <View style={{ flexDirection: 'row', height: '100%' }}>
          {item.onEdit ? (
            <SwipeButton
              label={editLabel}
              color={swipeEditColor}
              icon="edit"
              onPress={item.onEdit}
            />
          ) : null}
          {item.onDelete ? (
            <SwipeButton
              label={deleteLabel}
              color={swipeDeleteColor}
              icon="delete"
              onPress={item.onDelete}
            />
          ) : null}
        </View>
      )}
    >
      <Pressable
        accessibilityRole={item.onPress ? 'button' : 'text'}
        accessibilityLabel={label}
        disabled={!item.onPress}
        onPress={item.onPress}
        style={{
          minHeight: 64,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          backgroundColor: colors.card,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.line,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="body" style={{ fontWeight: '600', color: colors.ink }}>
            {item.title}
          </AppText>
          {item.subtitle ? <AppText variant="caption">{item.subtitle}</AppText> : null}
        </View>
        {item.onPress ? (
          <MaterialIcons name="chevron-right" size={22} color={colors.inkFaint} />
        ) : null}
      </Pressable>
    </Swipeable>
  );
}

function SwipeButton({
  label,
  color,
  icon,
  onPress,
}: {
  label: string;
  color: string;
  icon: 'edit' | 'delete';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: ACTION_WIDTH,
        height: '100%',
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <MaterialIcons name={icon} size={22} color="#FFFFFF" />
      <AppText style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>{label}</AppText>
    </Pressable>
  );
}

import { Host } from '@expo/ui';
import {
  Button,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  SwipeActions,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  ignoreSafeArea,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparatorTint,
  listStyle,
  scrollContentBackground,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { colors } from '@/theme/colors';

import { swipeEditColor, type ActionListItem } from './action-list-model';
import { View } from 'react-native';

export type { ActionListItem };

/**
 * Native grouped list. A left swipe reveals delete, and edit when the row can change.
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
    <Host style={{ flex: 1 }}>
      <List
        modifiers={[
          listStyle('insetGrouped'),
          scrollContentBackground('hidden'),
          background(colors.canvas),
          ignoreSafeArea({ edges: 'top' }),
        ]}
      >
        <Section>
          {items.map((item) => (
            <ActionRow key={item.id} item={item} editLabel={editLabel} deleteLabel={deleteLabel} />
          ))}
        </Section>
      </List>
    </Host>
  );
}

function ActionRow({
  item,
  editLabel,
  deleteLabel,
}: {
  item: ActionListItem;
  editLabel: string;
  deleteLabel: string;
}) {
  const label = item.subtitle ? `${item.title}, ${item.subtitle}` : item.title;
  const body = (
    <HStack alignment="center" spacing={12}>
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ size: 17, weight: 'semibold' }),
            foregroundStyle(colors.ink),
            lineLimit(2),
          ]}
        >
          {item.title}
        </Text>
        {item.subtitle ? (
          <Text modifiers={[font({ size: 14 }), foregroundStyle(colors.inkMuted), lineLimit(2)]}>
            {item.subtitle}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      {item.onPress ? <Image systemName="chevron.right" size={13} color={colors.inkFaint} /> : null}
    </HStack>
  );
  return (
    <SwipeActions
      modifiers={[
        listRowBackground(colors.card),
        listRowSeparatorTint(colors.line),
        listRowInsets({ top: 10, bottom: 10, leading: 16, trailing: 12 }),
      ]}
    >
      {item.onPress ? (
        <Button
          onPress={item.onPress}
          modifiers={[buttonStyle('plain'), accessibilityLabel(label)]}
        >
          {body}
        </Button>
      ) : (
        body
      )}
      {item.onDelete || item.onEdit ? (
        <SwipeActions.Actions edge="trailing" allowsFullSwipe={item.onDelete != null}>
          {item.onDelete ? (
            <Button
              role="destructive"
              label={deleteLabel}
              systemImage="trash"
              onPress={item.onDelete}
            />
          ) : null}
          {item.onEdit ? (
            <Button
              label={editLabel}
              systemImage="pencil"
              onPress={item.onEdit}
              modifiers={[tint(swipeEditColor)]}
            />
          ) : null}
        </SwipeActions.Actions>
      ) : null}
    </SwipeActions>
  );
}

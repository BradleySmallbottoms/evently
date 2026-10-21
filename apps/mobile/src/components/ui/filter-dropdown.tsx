import { MenuView } from '@expo/ui/community/menu';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export type FilterOption = { id: string; label: string };

type Props = {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (id: string) => void;
};

function Chevron() {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={'chevron.down' as never} size={12} tintColor={colors.inkMuted} />;
  }
  return <MaterialIcons name="expand-more" size={18} color={colors.inkMuted} />;
}

function Pill({ text, active }: { text: string; active: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        backgroundColor: active ? colors.accentSoft : (colors.card as string),
        borderRadius: radius.pill,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.line,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        maxWidth: 180,
      }}
    >
      <AppText variant="label" numberOfLines={1} style={{ color: colors.ink, flexShrink: 1 }}>
        {text}
      </AppText>
      <Chevron />
    </View>
  );
}

/** Pill menu matching the search row in the reference: label and chevron. */
export function FilterDropdown({ label, value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  const active = selected != null && selected.id !== options[0]?.id;
  const text = active && selected ? selected.label : label;
  const pill = <Pill text={text} active={active} />;

  if (Platform.OS === 'web') {
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active ? `${label}, ${text}` : label}
          onPress={() => setOpen(true)}
        >
          {pill}
        </Pressable>
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                backgroundColor: 'rgba(17, 24, 32, 0.28)',
              }}
            />
            <View
              style={{
                backgroundColor: colors.card as string,
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
                padding: space.lg,
                maxHeight: '70%',
              }}
            >
              <AppText variant="subtitle" style={{ marginBottom: space.sm }}>
                {label}
              </AppText>
              <ScrollView>
                {options.map((option) => {
                  const chosen = option.id === value;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      onPress={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                      style={{
                        paddingVertical: space.md,
                        paddingHorizontal: space.sm,
                        borderRadius: radius.sm,
                        backgroundColor: chosen ? colors.accentSoft : 'transparent',
                      }}
                    >
                      <AppText
                        variant="body"
                        style={{ color: colors.ink, fontWeight: chosen ? '600' : '400' }}
                      >
                        {option.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </>
    );
  }

  return (
    <MenuView
      actions={options.map((option) => ({
        id: option.id,
        title: option.label,
        state: option.id === value ? 'on' : 'off',
      }))}
      onPressAction={({ nativeEvent }) => onChange(nativeEvent.event)}
    >
      <View accessibilityRole="button" accessibilityLabel={active ? `${label}, ${text}` : label}>
        {pill}
      </View>
    </MenuView>
  );
}

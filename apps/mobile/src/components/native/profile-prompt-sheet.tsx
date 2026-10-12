import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  title: string;
  body: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  saveNamedLabel: string;
  stayAnonymousLabel: string;
  saving: boolean;
  onSaveNamed: (displayName: string, recoveryEmail: string) => void;
  onStayAnonymous: (recoveryEmail: string) => void;
};

export function ProfilePromptSheet({
  isPresented,
  onDismiss,
  title,
  body,
  nameLabel,
  namePlaceholder,
  emailLabel,
  emailPlaceholder,
  saveNamedLabel,
  stayAnonymousLabel,
  saving,
  onSaveNamed,
  onStayAnonymous,
}: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet isPresented={isPresented} onDismiss={onDismiss} snapPoints={['full']}>
        <Column spacing={14}>
          <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
          <Text textStyle={{ fontSize: 15, color: colors.inkMuted as string }}>{body}</Text>
          <View style={{ gap: space.sm }}>
            <Text textStyle={{ fontSize: 13, fontWeight: '600' }}>{nameLabel}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={namePlaceholder}
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="words"
              style={inputStyle}
            />
          </View>
          <View style={{ gap: space.sm }}>
            <Text textStyle={{ fontSize: 13, fontWeight: '600' }}>{emailLabel}</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={emailPlaceholder}
              placeholderTextColor={colors.inkFaint}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
            />
          </View>
          <Pressable
            disabled={saving || name.trim().length < 2}
            onPress={() => onSaveNamed(name.trim(), email.trim())}
            style={{
              backgroundColor: colors.accent,
              borderRadius: radius.lg,
              paddingVertical: space.md + 2,
              alignItems: 'center',
              opacity: saving || name.trim().length < 2 ? 0.5 : 1,
            }}
          >
            <Text textStyle={{ fontSize: 16, fontWeight: '700', color: colors.primary }}>
              {saveNamedLabel}
            </Text>
          </Pressable>
          <Pressable
            disabled={saving}
            onPress={() => onStayAnonymous(email.trim())}
            style={{
              paddingVertical: space.md,
              alignItems: 'center',
              opacity: saving ? 0.5 : 1,
            }}
          >
            <Text textStyle={{ fontSize: 15, fontWeight: '600', color: colors.ink as string }}>
              {stayAnonymousLabel}
            </Text>
          </Pressable>
        </Column>
      </BottomSheet>
    </Host>
  );
}

const inputStyle = {
  backgroundColor: colors.canvas as string,
  borderRadius: radius.md,
  paddingHorizontal: space.lg,
  paddingVertical: space.md,
  fontSize: 16,
  color: colors.ink as string,
};

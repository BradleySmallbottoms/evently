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
  commentLabel: string;
  commentPlaceholder: string;
  submitLabel: string;
  saving: boolean;
  onSubmit: (score: number, comment: string) => void;
};

export function RatingSheet({
  isPresented,
  onDismiss,
  title,
  body,
  commentLabel,
  commentPlaceholder,
  submitLabel,
  saving,
  onSubmit,
}: Props) {
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState('');

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet isPresented={isPresented} onDismiss={onDismiss} snapPoints={['half', 'full']}>
        <Column spacing={14}>
          <Text textStyle={{ fontSize: 20, fontWeight: '700' }}>{title}</Text>
          <Text textStyle={{ fontSize: 15, color: colors.inkMuted as string }}>{body}</Text>
          <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => setScore(n)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.pill,
                  backgroundColor: n <= score ? colors.accent : colors.canvas,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  textStyle={{
                    fontSize: 16,
                    fontWeight: '700',
                    color: n <= score ? colors.primary : (colors.ink as string),
                  }}
                >
                  {String(n)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text textStyle={{ fontSize: 13, fontWeight: '600' }}>{commentLabel}</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder={commentPlaceholder}
            placeholderTextColor={colors.inkFaint}
            multiline
            style={{
              backgroundColor: colors.canvas as string,
              borderRadius: radius.md,
              padding: space.md,
              minHeight: 72,
              fontSize: 16,
              color: colors.ink as string,
            }}
          />
          <Pressable
            disabled={saving}
            onPress={() => onSubmit(score, comment.trim())}
            style={{
              backgroundColor: colors.accent,
              borderRadius: radius.lg,
              paddingVertical: space.md + 2,
              alignItems: 'center',
              opacity: saving ? 0.5 : 1,
            }}
          >
            <Text textStyle={{ fontSize: 16, fontWeight: '700', color: colors.primary }}>
              {submitLabel}
            </Text>
          </Pressable>
        </Column>
      </BottomSheet>
    </Host>
  );
}

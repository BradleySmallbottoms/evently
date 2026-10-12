import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { space } from '@/theme/tokens';

type Props = {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, body, actionLabel, onAction }: Props) {
  return (
    <View style={{ paddingHorizontal: space.xl, gap: space.md, paddingTop: space.lg }}>
      <AppText variant="subtitle">{title}</AppText>
      <AppText variant="body">{body}</AppText>
      {actionLabel && onAction ? <PrimaryButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

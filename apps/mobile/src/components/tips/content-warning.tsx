import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

import { ChatArrival } from './chat-arrival';

/** A refused answer. Grows into place, then fades in. */
export function ContentWarning({ text }: { text: string }) {
  return (
    <ChatArrival
      pieces={[
        <View
          key="warning"
          style={{
            alignSelf: 'stretch',
            backgroundColor: colors.accentSoft,
            borderRadius: 22,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
          }}
        >
          <AppText variant="body">{text}</AppText>
        </View>,
      ]}
    />
  );
}

import { BottomSheet, Column, Host, Text } from '@expo/ui';
import { View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';

export type MapEventSelection = {
  id: string;
  title: string;
  when: string;
};

type Props = {
  selected: MapEventSelection | null;
  onDismiss: () => void;
  readMoreLabel: string;
  onReadMore: (id: string) => void;
};

/** Map marker detail sheet — lives in components/native (Expo UI overlay, not under app/). */
export function MapEventSheet({ selected, onDismiss, readMoreLabel, onReadMore }: Props) {
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={!!selected}
        onDismiss={onDismiss}
        snapPoints={['half']}
      >
        <Column spacing={12}>
          <Text textStyle={{ fontSize: 22, fontWeight: '700' }}>{selected?.title ?? ''}</Text>
          <Text textStyle={{ fontSize: 14, color: colors.inkMuted as string }}>
            {selected?.when ?? ''}
          </Text>
          <View>
            <PrimaryButton
              label={readMoreLabel}
              onPress={() => {
                const id = selected?.id;
                onDismiss();
                if (id) onReadMore(id);
              }}
            />
          </View>
        </Column>
      </BottomSheet>
    </Host>
  );
}

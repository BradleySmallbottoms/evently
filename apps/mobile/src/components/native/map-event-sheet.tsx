import { BottomSheet, Host } from '@expo/ui';
import { useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';
import { SheetBody } from './sheet-body';

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
  const { width: windowWidth } = useWindowDimensions();
  // The sheet sizes itself to its content. Unconstrained text measures as one
  // line and pushes that content past the sheet edges, so pin the column to
  // the width left after the sheet's horizontal padding.
  const contentWidth = windowWidth - space.xl * 2;

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={!!selected}
        onDismiss={onDismiss}
        containerColor={colors.card}
        contentPadding={{ top: space.xxxl, bottom: space.md, left: space.xl, right: space.xl }}
      >
        <SheetBody>
          <View style={{ width: contentWidth, gap: space.lg }}>
            <AppText variant="subtitle" style={{ fontSize: 22, lineHeight: 28 }}>
              {selected?.title ?? ''}
            </AppText>
            <AppText style={{ width: contentWidth, color: colors.inkMuted, lineHeight: 22 }}>
              {selected?.when ?? ''}
            </AppText>
            <PrimaryButton
              label={readMoreLabel}
              onPress={() => {
                const id = selected?.id;
                onDismiss();
                if (id) onReadMore(id);
              }}
            />
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}

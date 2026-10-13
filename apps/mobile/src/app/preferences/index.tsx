import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackPill } from '@/components/ui/back-pill';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';
import { PreferencesForm } from '@/components/preferences/preferences-form';

export default function PreferencesScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md }}>
        <BackPill />
      </View>
      <PreferencesForm />
    </View>
  );
}

import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';
import { PreferencesForm } from './_components/preferences-form';

export default function PreferencesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <Pressable
        onPress={() => router.back()}
        style={{ paddingHorizontal: space.xl, paddingVertical: space.md }}
      >
        <AppText variant="label" style={{ color: colors.accent }}>
          {t('preferences.back')}
        </AppText>
      </Pressable>
      <PreferencesForm />
    </View>
  );
}

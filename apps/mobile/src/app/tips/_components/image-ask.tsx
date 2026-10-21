import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export function ImageAsk({
  locked,
  onSkip,
  onUpload,
}: {
  locked: boolean;
  onSkip: () => void;
  onUpload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      <PrimaryButton
        label={t('tips.addPicture')}
        loading={uploading}
        disabled={locked || uploading}
        onPress={() => {
          setUploading(true);
          void onUpload().finally(() => setUploading(false));
        }}
      />
      <PrimaryButton
        label={t('tips.noPicture')}
        color={colors.card}
        labelColor={colors.ink}
        disabled={locked || uploading}
        onPress={onSkip}
      />
    </View>
  );
}

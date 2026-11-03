import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PhotoSourceMenu } from '@/components/native/photo-source-menu';
import { PrimaryButton } from '@/components/ui/primary-button';
import type { TipImageSource } from '@/lib/camera';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export function ImageAsk({
  locked,
  onSkip,
  onUpload,
}: {
  locked: boolean;
  onSkip: () => void;
  onUpload: (source: TipImageSource) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      <PhotoSourceMenu
        cameraLabel={t('tips.takePhoto')}
        libraryLabel={t('tips.photoLibrary')}
        onPick={(source) => {
          if (locked || uploading) return;
          setUploading(true);
          void onUpload(source).finally(() => setUploading(false));
        }}
      >
        <PrimaryButton
          label={t('tips.addPicture')}
          loading={uploading}
          disabled={locked || uploading}
        />
      </PhotoSourceMenu>
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

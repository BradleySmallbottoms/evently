import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

/** Steps the import scan stored on `meta.instructions`. Hidden when there are none. */
export function HowItWorks({ steps }: { steps: string[] }) {
  const { t } = useTranslation();
  const items = steps.map((step) => step.trim()).filter((step) => step.length > 0);
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space.lg }} accessibilityRole="summary">
      <AppText style={sectionTitle}>{t('events.detail.howTitle')}</AppText>
      <View style={{ gap: space.md }}>
        {items.map((step, index) => (
          <View
            key={`${index}-${step}`}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: radius.pill,
                backgroundColor: colors.canvas,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppText
                style={{ fontSize: 13, lineHeight: 16, fontWeight: '700', color: colors.inkMuted }}
              >
                {index + 1}
              </AppText>
            </View>
            <AppText
              variant="subtitle"
              style={{ flex: 1, paddingTop: 3, fontSize: 14, lineHeight: 22, fontWeight: '400' }}
            >
              {step}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const sectionTitle = {
  fontSize: 20,
  lineHeight: 26,
  fontWeight: '700' as const,
  color: colors.ink,
};

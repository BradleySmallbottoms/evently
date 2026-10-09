import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  type TabTriggerSlotProps,
  type TabListProps,
} from 'expo-router/ui';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { brand } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

export default function AppTabs() {
  const { t } = useTranslation();
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton>{t('tabs.list')}</TabButton>
          </TabTrigger>
          <TabTrigger name="map" href="/map" asChild>
            <TabButton>{t('tabs.map')}</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, onPress }: TabTriggerSlotProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      onPress={onPress}
      style={{
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        borderCurve: 'continuous',
        backgroundColor: isFocused ? brand.accent : 'transparent',
      }}
    >
      <AppText
        variant="label"
        style={{ color: isFocused ? '#FFFFFF' : brand.ink, fontWeight: '700' }}
      >
        {children}
      </AppText>
    </Pressable>
  );
}

function CustomTabList(props: TabListProps) {
  const { t } = useTranslation();
  return (
    <View
      style={{
        position: 'absolute',
        width: '100%',
        padding: space.md,
        flexDirection: 'row',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          flex: 1,
          maxWidth: 768,
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: radius.xl,
          borderCurve: 'continuous',
          backgroundColor: brand.card,
          paddingHorizontal: space.xl,
          paddingVertical: space.sm,
          gap: space.sm,
          boxShadow: shadow.card,
        }}
      >
        <AppText variant="subtitle" style={{ marginRight: 'auto' }}>
          {t('app.name')}
        </AppText>
        {props.children}
      </View>
    </View>
  );
}

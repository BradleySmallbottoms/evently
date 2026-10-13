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
import { useHasUnreadNotifications } from '@/lib/use-unread-notifications';
import { brand } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

export default function AppTabs() {
  const { t } = useTranslation();
  const { hasUnread, numUnread } = useHasUnreadNotifications();
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton>{t('tabs.list')}</TabButton>
          </TabTrigger>
          <TabTrigger name="search" href="/search" asChild>
            <TabButton>{t('tabs.search')}</TabButton>
          </TabTrigger>
          <TabTrigger name="events" href="/events" asChild>
            <TabButton>{t('tabs.events')}</TabButton>
          </TabTrigger>
          <TabTrigger name="saved" href="/saved" asChild>
            <TabButton>{t('tabs.saved')}</TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton
              showBadge={hasUnread}
              accessibilityLabel={hasUnread ? t('tabs.profileUnread') : t('tabs.profile')}
            >
              {t('tabs.profile')}
              {hasUnread ? <View style={{ position: 'absolute', top: 0, right: -6, width: 4, height: 4, borderRadius: radius.pill, backgroundColor: brand.error }} /> : null}
            </TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

function TabButton({
  children,
  isFocused,
  onPress,
  showBadge,
  accessibilityLabel,
}: TabTriggerSlotProps & { showBadge?: boolean }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!isFocused }}
      onPress={onPress}
      style={{
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        borderCurve: 'continuous',
        backgroundColor: isFocused ? brand.accentSoft : 'transparent',
      }}
    >
      <View>
        <AppText
          variant="label"
          style={{ color: isFocused ? brand.primary : brand.ink, fontWeight: '700' }}
        >
          {children}
        </AppText>
        {showBadge ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              top: 0,
              right: -6,
              width: 4,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: brand.error,
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function CustomTabList(props: TabListProps) {
  const { t } = useTranslation();
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0,
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
          backgroundColor: 'rgba(255,255,255,0.96)',
          paddingHorizontal: space.xl,
          paddingVertical: space.md,
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

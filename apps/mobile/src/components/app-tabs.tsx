import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';

import { brand } from '@/constants/theme';
import { useHasUnreadNotifications } from '@/lib/use-unread-notifications';

export default function AppTabs() {
  const { t } = useTranslation();
  const { hasUnread, numUnread } = useHasUnreadNotifications();

  return (
    <NativeTabs
      backgroundColor={brand.background}
      badgeBackgroundColor={brand.error}
      indicatorColor={brand.accentSoft}
      tintColor={brand.primary}
      labelStyle={{ selected: { color: brand.primary }, default: { color: brand.textSecondary } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('tabs.list')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house" md="home" />
      </NativeTabs.Trigger>
      {/* <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Label>{t('tabs.search')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger> */}
      <NativeTabs.Trigger name="events">
        <NativeTabs.Trigger.Label>{t('tabs.events')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="event" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>{t('tabs.saved')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="heart" md="favorite_border" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="profile"
        accessibilityLabel={hasUnread ? t('tabs.profileUnread') : t('tabs.profile')}
      >
        <NativeTabs.Trigger.Label>{t('tabs.profile')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person" md="person" />
        {hasUnread ? <NativeTabs.Trigger.Badge >{numUnread > 99 ? '99+' : numUnread.toString()}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';

import { useAppearance } from '@/lib/appearance-context';
import { colors } from '@/theme/colors';
import { useHasUnreadNotifications } from '@/lib/use-unread-notifications';

export default function AppTabs() {
  const { t } = useTranslation();
  useAppearance();
  const { hasUnread, numUnread } = useHasUnreadNotifications();

  return (
    <NativeTabs
      backgroundColor={colors.canvas}
      badgeBackgroundColor={colors.danger}
      indicatorColor={colors.accentSoft}
      tintColor={colors.ink}
      labelStyle={{ selected: { color: colors.ink }, default: { color: colors.inkMuted } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('tabs.list')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>{t('tabs.explore')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="safari" md="explore" />
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
        {hasUnread ? (
          <NativeTabs.Trigger.Badge>
            {numUnread > 99 ? '99+' : numUnread.toString()}
          </NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

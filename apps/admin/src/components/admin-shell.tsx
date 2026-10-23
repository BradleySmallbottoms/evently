'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellIcon,
  CalendarIcon,
  ClipboardCheckIcon,
  DatabaseIcon,
  LogOutIcon,
  ScrollTextIcon,
  ShieldIcon,
  StoreIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { ADMIN_ME_QUERY_KEY, adminShellMode, isAdminSignedIn } from '@/lib/admin-session';
import { adminFetch } from '@/lib/api';

type Me = { adminId: string; email: string; role: string; expiresAt: string };

const NAV = [
  {
    href: '/review',
    key: 'navEvents',
    icon: ClipboardCheckIcon,
    match: (path: string) => path.startsWith('/review'),
  },
  {
    href: '/events/manage',
    key: 'navEventCatalog',
    icon: CalendarIcon,
    match: (path: string) => path.startsWith('/events'),
  },
  {
    href: '/publishers',
    key: 'navPublishers',
    icon: StoreIcon,
    match: (path: string) => path.startsWith('/publishers'),
  },
  {
    href: '/push-messages',
    key: 'navPushMessages',
    icon: BellIcon,
    match: (path: string) => path.startsWith('/push-messages'),
  },
  {
    href: '/moderation',
    key: 'navModeration',
    icon: ShieldIcon,
    match: (path: string) => path.startsWith('/moderation'),
  },
  {
    href: '/data-sources',
    key: 'navDataSources',
    icon: DatabaseIcon,
    match: (path: string) => path.startsWith('/data-sources'),
  },
  {
    href: '/audit-log',
    key: 'navAuditLog',
    icon: ScrollTextIcon,
    match: (path: string) => path.startsWith('/audit-log'),
  },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const t = useTranslations('App');
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ADMIN_ME_QUERY_KEY,
    queryFn: () => adminFetch<Me>('/admin/me'),
    retry: false,
  });
  const mode = adminShellMode({
    pending: me.isPending,
    signedIn: isAdminSignedIn(me.data, me.error),
    pathname,
  });

  useEffect(() => {
    if (mode === 'redirect') router.replace('/login');
  }, [mode, router]);

  async function logout() {
    await adminFetch('/admin/logout', { method: 'POST' });
    queryClient.removeQueries({ queryKey: ADMIN_ME_QUERY_KEY });
    router.replace('/login');
  }

  if (mode === 'pending' || mode === 'redirect') {
    // The page stays mounted so Next can see the segment, and hidden so a
    // signed-out visit shows a blank screen until it lands on the login form.
    return (
      <div className="min-h-svh bg-background">
        <div hidden>{children}</div>
      </div>
    );
  }

  if (mode === 'login') {
    return <div className="flex min-h-svh flex-col">{children}</div>;
  }

  if (!me.data) {
    return <div className="min-h-svh bg-background" />;
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<Link href="/" />}>
                <span className="font-semibold">{t('name')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={item.match(pathname)}
                      >
                        <Icon />
                        <span>{t(item.key)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <span className="truncate px-2 text-xs text-sidebar-foreground/70">
                {me.data.email}
              </span>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => void logout()}>
                <LogOutIcon />
                <span>{t('logout')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="flex flex-1 flex-col px-6 py-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

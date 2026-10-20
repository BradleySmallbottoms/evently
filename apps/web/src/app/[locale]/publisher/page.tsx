import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { WorkspacePanel } from './components/workspace-panel';

const backLinkClass = 'text-sm text-muted-foreground underline-offset-4 hover:underline';

export default async function PublisherWorkspacePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const nav = await getTranslations('Nav');

  return (
    <PageMain maxWidth="sm">
      <div className="flex flex-col gap-2">
        <AppLink href="/" className={backLinkClass}>
          {nav('home')}
        </AppLink>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {nav('workspace')}
        </h1>
      </div>
      <WorkspacePanel />
    </PageMain>
  );
}

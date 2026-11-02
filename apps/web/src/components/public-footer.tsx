import { getTranslations } from 'next-intl/server';
import { AppLink } from '@/components/app-link';

const linkClass = 'underline-offset-4 hover:underline';

export async function PublicFooter() {
  const t = await getTranslations('Legal');

  return (
    <footer className="mt-auto flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-6 text-sm text-muted-foreground">
      <AppLink href="/integritet" className={linkClass}>
        {t('privacyLink')}
      </AppLink>
      <AppLink href="/support" className={linkClass}>
        {t('supportLink')}
      </AppLink>
    </footer>
  );
}

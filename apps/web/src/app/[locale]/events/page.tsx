import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { serverApiUrl } from '@/lib/server-api-url';
import { PublicEventCard, type PublicEventCardData } from './components/public-event-card';

const FALLBACK_LAT = 61.3037;
const FALLBACK_LNG = 17.0592;
const FALLBACK_RADIUS_M = 50_000;
const API_URL = serverApiUrl();

const backLinkClass = 'text-sm text-muted-foreground underline-offset-4 hover:underline';

export default async function PublicEventsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('PublicEvents');
  const nav = await getTranslations('Nav');
  const res = await fetch(
    `${API_URL}/events?lat=${FALLBACK_LAT}&lng=${FALLBACK_LNG}&radiusM=${FALLBACK_RADIUS_M}`,
    { cache: 'no-store' },
  );

  const items: PublicEventCardData[] = res.ok
    ? ((await res.json()) as { items: PublicEventCardData[] }).items
    : [];

  return (
    <PageMain>
      <div className="flex flex-col gap-2">
        <AppLink href="/" className={backLinkClass}>
          {nav('home')}
        </AppLink>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((event) => (
            <PublicEventCard
              key={event.id}
              event={event}
              locale={locale}
              venueLabel={t('venue')}
              onlineLabel={t('online')}
              missingVenue={t('missingVenue')}
              missingUrl={t('missingUrl')}
              readMoreLabel={t('readMore')}
            />
          ))}
        </ul>
      )}
    </PageMain>
  );
}

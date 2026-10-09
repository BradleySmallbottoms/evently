import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';
import { PublicEventCard, type PublicEventCardData } from './components/public-event-card';

const FALLBACK_LAT = 61.3037;
const FALLBACK_LNG = 17.0592;
const FALLBACK_RADIUS_M = 50_000;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/v1';

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
      <Stack spacing={1}>
        <Link component={AppLink} href="/" underline="hover" variant="body2" color="text.secondary">
          {nav('home')}
        </Link>
        <Typography variant="h4" component="h1">
          {t('title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('subtitle')}
        </Typography>
      </Stack>
      {items.length === 0 ? (
        <Typography color="text.secondary">{t('empty')}</Typography>
      ) : (
        <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
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
        </Stack>
      )}
    </PageMain>
  );
}

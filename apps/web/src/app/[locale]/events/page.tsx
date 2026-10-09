import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppLink } from '@/components/app-link';
import { PageMain } from '@/components/page-main';

const FALLBACK_LAT = 61.3037;
const FALLBACK_LNG = 17.0592;
const FALLBACK_RADIUS_M = 50_000;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/v1';

type PublicEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  mode: 'physical' | 'digital';
  venueName: string | null;
  onlineUrl: string | null;
};

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

  const items: PublicEvent[] = res.ok ? ((await res.json()) as { items: PublicEvent[] }).items : [];

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
            <Card key={event.id} component="li" variant="outlined">
              <CardContent>
                <Typography variant="h6" component="h2">
                  {event.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {new Date(event.startsAt).toLocaleString(locale)} -{' '}
                  {new Date(event.endsAt).toLocaleString(locale)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {event.mode === 'physical'
                    ? `${t('venue')}: ${event.venueName ?? t('missingVenue')}`
                    : `${t('online')}: ${event.onlineUrl ?? t('missingUrl')}`}
                </Typography>
                <Link
                  component={AppLink}
                  href={`/events/${event.id}`}
                  underline="hover"
                  variant="body2"
                  sx={{ mt: 1.5, display: 'inline-block' }}
                >
                  {t('readMore')}
                </Link>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </PageMain>
  );
}

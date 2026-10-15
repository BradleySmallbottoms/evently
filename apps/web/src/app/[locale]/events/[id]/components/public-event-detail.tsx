import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AppLink } from '@/components/app-link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:13000/v1';

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    return null;
  }
  return null;
}

type PublicEvent = {
  id: string;
  title: string;
  description: string | null;
  mode: 'physical' | 'digital';
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  location: { lat: number; lng: number } | null;
  onlineUrl: string | null;
  status: string;
};

export async function PublicEventDetail({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('PublicEvents');
  const nav = await getTranslations('Nav');

  const res = await fetch(`${API_URL}/events/${id}`, { cache: 'no-store' });
  if (!res.ok) notFound();
  const event = (await res.json()) as PublicEvent;
  const onlineUrl = safeHttpUrl(event.onlineUrl);
  const statsParams = new URLSearchParams();
  for (const key of ['numCheckins', 'numRatings', 'totalRatingValue']) {
    statsParams.append('key', key);
  }
  const statsRes = await fetch(`${API_URL}/stats/event/${id}?${statsParams}`, {
    cache: 'no-store',
  });
  const statsItems = statsRes.ok
    ? (((await statsRes.json()) as { items: { key: string; value: number }[] }).items ?? [])
    : [];
  const statsMap = Object.fromEntries(statsItems.map((i) => [i.key, i.value]));
  const numCheckins = statsMap.numCheckins ?? 0;
  const numRatings = statsMap.numRatings ?? 0;
  const totalRatingValue = statsMap.totalRatingValue ?? 0;
  const ratingAverage =
    numRatings > 0 ? Math.round((totalRatingValue / numRatings) * 10) / 10 : null;
  const stats =
    numCheckins > 0 || numRatings > 0
      ? { numCheckins, numRatings, ratingAverage }
      : null;

  return (
    <>
      <Stack spacing={1}>
        <Link
          component={AppLink}
          href="/events"
          underline="hover"
          variant="body2"
          color="text.secondary"
        >
          {t('title')}
        </Link>
        <Typography variant="h3" component="h1">
          {event.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {new Date(event.startsAt).toLocaleString(locale)} -{' '}
          {new Date(event.endsAt).toLocaleString(locale)}
        </Typography>
      </Stack>
      <Card variant="outlined" component="section">
        <CardContent>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t('statusLabel')}: {t(`status.${event.status}`)}
            </Typography>
            {stats ? (
              <Typography variant="body2" color="text.secondary">
                {t('statsLine', {
                  checkIns: stats.numCheckins,
                  average: stats.ratingAverage ?? '–',
                  ratings: stats.numRatings,
                })}
              </Typography>
            ) : null}
            <Typography>{event.description ?? t('noDescription')}</Typography>
            {event.mode === 'physical' ? (
              <Stack spacing={0.5}>
                <Typography variant="body2">
                  {t('venue')}: {event.venueName ?? t('missingVenue')}
                </Typography>
                {event.location && (
                  <Typography variant="body2">
                    {t('coordinates')}: {event.location.lat.toFixed(5)},{' '}
                    {event.location.lng.toFixed(5)}
                  </Typography>
                )}
              </Stack>
            ) : (
              <Typography variant="body2">
                {t('online')}:{' '}
                {onlineUrl ? (
                  <Link href={onlineUrl} target="_blank" rel="noreferrer" underline="hover">
                    {onlineUrl}
                  </Link>
                ) : (
                  t('missingUrl')
                )}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
      <Link component={AppLink} href="/" underline="hover" variant="body2" color="text.secondary">
        {nav('home')}
      </Link>
    </>
  );
}

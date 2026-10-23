import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AppLink } from '@/components/app-link';
import { serverApiUrl } from '@/lib/server-api-url';

const API_URL = serverApiUrl();

const backLinkClass = 'text-sm text-muted-foreground underline-offset-4 hover:underline';

function safeHttpUrl(value: string | null | undefined): string | null {
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
  imageUrl?: string | null;
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
  const imageUrl = safeHttpUrl(event.imageUrl);
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
    numCheckins > 0 || numRatings > 0 ? { numCheckins, numRatings, ratingAverage } : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <AppLink href="/events" className={backLinkClass}>
          {t('title')}
        </AppLink>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="aspect-[16/10] w-full rounded-2xl object-cover" />
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{event.title}</h1>
        <p className="text-sm text-muted-foreground">
          {new Date(event.startsAt).toLocaleString(locale)} -{' '}
          {new Date(event.endsAt).toLocaleString(locale)}
        </p>
      </div>
      <section className="flex flex-col gap-3 rounded-2xl bg-card p-5 text-card-foreground ring-1 ring-border">
        <p className="text-sm text-muted-foreground">
          {t('statusLabel')}: {t(`status.${event.status}`)}
        </p>
        {stats ? (
          <p className="text-sm text-muted-foreground">
            {t('statsLine', {
              checkIns: stats.numCheckins,
              average: stats.ratingAverage ?? '–',
              ratings: stats.numRatings,
            })}
          </p>
        ) : null}
        <p className="text-base text-foreground">{event.description ?? t('noDescription')}</p>
        {event.mode === 'physical' ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-foreground">
              {t('venue')}: {event.venueName ?? t('missingVenue')}
            </p>
            {event.location && (
              <p className="text-sm text-foreground">
                {t('coordinates')}: {event.location.lat.toFixed(5)}, {event.location.lng.toFixed(5)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-foreground">
            {t('online')}:{' '}
            {onlineUrl ? (
              <a
                href={onlineUrl}
                target="_blank"
                rel="noreferrer"
                className="text-info underline-offset-4 hover:underline"
              >
                {onlineUrl}
              </a>
            ) : (
              t('missingUrl')
            )}
          </p>
        )}
      </section>
      <AppLink href="/" className={backLinkClass}>
        {nav('home')}
      </AppLink>
    </>
  );
}

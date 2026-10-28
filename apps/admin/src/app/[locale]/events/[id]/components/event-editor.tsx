'use client';

import { canRescanImportedEvent } from '@local-events/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { cn } from 'cn';
import { LoadingRows } from '@/components/list-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/navigation';
import { AdminApiError, adminFetch } from '@/lib/api';
import { toDatetimeLocal, zonedLocalToIso } from '@/lib/zoned-datetime';
import { EventImages } from './event-images';
import { EventPoster } from './event-poster';
import { EventLocationMap } from './event-location-map';
import { EventNotifications } from './event-notifications';
import { EventOccasions, possibleDuplicatesQuery } from './event-occasions';
import { EventScan } from './event-scan';
import { EventTagsField } from './event-tags-field';

type EventMode = 'physical' | 'digital';
type EventStatus =
  | 'draft'
  | 'awaiting_verification'
  | 'pending_scan'
  | 'in_review'
  | 'published'
  | 'cancelled'
  | 'ended';
type LinkType = 'tickets' | 'registration' | 'info' | 'facebook' | 'instagram';

type EventDetail = {
  id: string;
  publisherId: string | null;
  publisherName: string;
  title: string;
  description: string | null;
  mode: EventMode;
  status: EventStatus;
  origin: 'native' | 'imported';
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  venueName: string | null;
  location: { lat: number; lng: number } | null;
  geofenceRadiusM: number | null;
  onlineUrl: string | null;
  priceAmount: number | null;
  currency: string;
  sourceUrl: string | null;
  refId: string | null;
  workerId: string | null;
  occasions?: {
    id: string;
    startsAt: string;
    endsAt: string;
    venueName: string | null;
  }[];
  meta: {
    possibleOccasionGroupId?: string;
    possibleDuplicate?: {
      eventId: string;
      title: string;
      startsAt: string;
      refId: string | null;
      workerId: string | null;
      matchedOn: 'title' | 'event-link' | 'link' | 'id' | 'llm';
    };
    mergedDuplicates?: { eventId: string; title: string }[];
    duplicateOf?: { eventId: string; title: string };
  };
  tagIds: string[];
  featured: boolean;
  sponsored: boolean;
  checkInEnabled: boolean;
  imageUrl: string | null;
  imageUrls: string[];
  posterUrl: string | null;
  links: { type: LinkType; url: string; label: string | null }[];
  llmOutput: unknown;
  createdAt: string;
  updatedAt: string;
};

type TagOption = { id: string; name: string };

type DraftLink = { type: LinkType; url: string; label: string };

type Draft = {
  title: string;
  description: string;
  mode: EventMode;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venueName: string;
  lat: string;
  lng: string;
  geofenceRadiusM: string;
  onlineUrl: string;
  priceAmount: string;
  currency: string;
  tagIds: string[];
  links: DraftLink[];
  featured: boolean;
  sponsored: boolean;
  checkInEnabled: boolean;
};

const STATUSES: EventStatus[] = [
  'draft',
  'awaiting_verification',
  'in_review',
  'published',
  'cancelled',
  'ended',
];

const LINK_TYPES: LinkType[] = ['tickets', 'registration', 'info', 'facebook', 'instagram'];

type EditorTab = 'info' | 'location' | 'notifications' | 'scan' | 'occasions';

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return value;
  } catch {
    return null;
  }
  return null;
}

function toDraft(event: EventDetail): Draft {
  return {
    title: event.title,
    description: event.description ?? '',
    mode: event.mode,
    status: event.status,
    startsAt: event.startsAt ? toDatetimeLocal(event.startsAt, event.timezone) : '',
    endsAt: event.endsAt ? toDatetimeLocal(event.endsAt, event.timezone) : '',
    timezone: event.timezone,
    venueName: event.venueName ?? '',
    lat: event.location ? String(event.location.lat) : '',
    lng: event.location ? String(event.location.lng) : '',
    geofenceRadiusM: event.geofenceRadiusM == null ? '' : String(event.geofenceRadiusM),
    onlineUrl: event.onlineUrl ?? '',
    priceAmount: event.priceAmount == null ? '' : String(event.priceAmount),
    currency: event.currency,
    tagIds: event.tagIds,
    featured: event.featured,
    sponsored: event.sponsored,
    checkInEnabled: event.checkInEnabled,
    links: event.links.map((link) => ({
      type: link.type,
      url: link.url,
      label: link.label ?? '',
    })),
  };
}

function isEditorTab(value: unknown): value is EditorTab {
  return (
    value === 'info' ||
    value === 'location' ||
    value === 'notifications' ||
    value === 'scan' ||
    value === 'occasions'
  );
}

export function EventEditor({ eventId }: { eventId: string }) {
  const t = useTranslations('EventEditor');
  const tApp = useTranslations('App');
  const queryClient = useQueryClient();
  const [eventKey, setEventKey] = useState(eventId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<EditorTab>('info');
  if (eventKey !== eventId) {
    setEventKey(eventId);
    setDraft(null);
    setNotice(null);
    setFormError(null);
    setTab('info');
  }

  const eventQuery = useQuery({
    queryKey: ['admin-event', eventId],
    queryFn: () => adminFetch<EventDetail>(`/events/${eventId}`),
    retry: false,
  });
  const duplicates = useQuery({
    ...possibleDuplicatesQuery(eventId),
    retry: false,
  });

  const categories = useQuery({
    queryKey: ['admin-tags'],
    queryFn: () => adminFetch<{ items: TagOption[] }>('/tags'),
    retry: false,
  });

  const form =
    draft ?? (eventQuery.data && eventQuery.data.id === eventId ? toDraft(eventQuery.data) : null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      adminFetch<EventDetail>(`/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: async (saved) => {
      setDraft(toDraft(saved));
      setNotice(t('saved'));
      setFormError(null);
      queryClient.setQueryData(['admin-event', eventId], saved);
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    },
  });

  const rescan = useMutation({
    mutationFn: () => adminFetch(`/events/${eventId}/rescan`, { method: 'POST' }),
    onSuccess: async () => {
      setDraft(null);
      setNotice(t('rescanned'));
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-event', eventId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-events-in-review'] });
    },
    onError: () => {
      setNotice(null);
      setFormError(t('rescanError'));
    },
  });

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (!form) return;
    setDraft({ ...form, [key]: value });
  }

  function onSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!form) return;
    setNotice(null);
    setFormError(null);
    const latRaw = form.lat.trim();
    const lngRaw = form.lng.trim();
    if ((latRaw === '') !== (lngRaw === '')) {
      setFormError(t('invalidLocation'));
      return;
    }
    const location = latRaw && lngRaw ? { lat: Number(latRaw), lng: Number(lngRaw) } : null;
    if (location && (!Number.isFinite(location.lat) || !Number.isFinite(location.lng))) {
      setFormError(t('invalidLocation'));
      return;
    }
    const priceRaw = form.priceAmount.trim();
    if (priceRaw !== '' && !/^\d+$/.test(priceRaw)) {
      setFormError(t('invalidPrice'));
      return;
    }
    const radiusRaw = form.geofenceRadiusM.trim();
    if (radiusRaw !== '' && !/^\d+$/.test(radiusRaw)) {
      setFormError(t('invalidRadius'));
      return;
    }
    const links = form.links
      .map((link) => ({
        type: link.type,
        url: link.url.trim(),
        label: link.label.trim(),
      }))
      .filter((link) => link.url || link.label);
    if (links.some((link) => !link.url)) {
      setFormError(t('invalidLink'));
      return;
    }
    const timesOnOccasions = (eventQuery.data?.occasions?.length ?? 0) > 0;
    let times: { startsAt: string; endsAt: string; venueName: string | null } | undefined;
    if (!timesOnOccasions) {
      try {
        times = {
          startsAt: zonedLocalToIso(form.startsAt, form.timezone.trim() || 'Europe/Stockholm'),
          endsAt: zonedLocalToIso(form.endsAt, form.timezone.trim() || 'Europe/Stockholm'),
          venueName: form.venueName.trim() || null,
        };
      } catch {
        setFormError(t('invalidTime'));
        return;
      }
    }
    save.mutate({
      title: form.title.trim(),
      description: form.description.trim() || null,
      mode: form.mode,
      ...times,
      timezone: form.timezone.trim() || 'Europe/Stockholm',
      location,
      geofenceRadiusM: radiusRaw === '' ? null : Number(radiusRaw),
      onlineUrl: form.onlineUrl.trim() || null,
      priceAmount: priceRaw === '' ? null : Number(priceRaw),
      currency: form.currency.trim() || 'SEK',
      tagIds: form.tagIds,
      featured: form.featured,
      sponsored: form.sponsored,
      checkInEnabled: form.checkInEnabled,
      ...(form.status === 'pending_scan' ? {} : { status: form.status }),
      links: links.map((link) => ({
        type: link.type,
        url: link.url,
        ...(link.label ? { label: link.label } : {}),
      })),
    });
  }

  if (eventQuery.isError) {
    const unauthorized =
      eventQuery.error instanceof AdminApiError && eventQuery.error.status === 401;
    const missing = eventQuery.error instanceof AdminApiError && eventQuery.error.status === 404;
    return (
      <Alert variant={unauthorized ? 'default' : 'destructive'}>
        <AlertDescription>
          {unauthorized ? (
            <>
              {t('needLogin')}{' '}
              <Link href="/login" className="underline underline-offset-4">
                {tApp('navLogin')}
              </Link>
            </>
          ) : missing ? (
            t('notFound')
          ) : (
            t('loadError')
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (!form || eventQuery.isLoading) {
    return <LoadingRows />;
  }

  const event = eventQuery.data;
  const timesOnOccasions = (event?.occasions?.length ?? 0) > 0;
  const showOccasions =
    (event?.occasions?.length ?? 0) > 0 ||
    Boolean(event?.meta.possibleOccasionGroupId) ||
    Boolean(event?.meta.possibleDuplicate) ||
    Boolean(event?.meta.duplicateOf) ||
    (event?.meta.mergedDuplicates?.length ?? 0) > 0 ||
    (duplicates.data?.items.length ?? 0) > 0;
  const activeTab: EditorTab = tab === 'occasions' && !showOccasions ? 'info' : tab;
  const source = httpUrl(event?.sourceUrl ?? null);
  const saveError =
    formError ??
    (save.isError
      ? save.error instanceof AdminApiError && save.error.code === 'online_url_required'
        ? t('onlineRequired')
        : save.error instanceof AdminApiError && save.error.code === 'invalid_event'
          ? t('invalidEvent')
          : t('saveError')
      : null);

  const statusLabel = (status: EventStatus) =>
    t(
      status === 'awaiting_verification'
        ? 'statusAwaiting'
        : status === 'pending_scan'
          ? 'statusPendingScan'
          : status === 'in_review'
            ? 'statusInReview'
            : status === 'draft'
              ? 'statusDraft'
              : status === 'published'
                ? 'statusPublished'
                : status === 'cancelled'
                  ? 'statusCancelled'
                  : 'statusEnded',
    );
  const statusItems = Object.fromEntries(STATUSES.map((status) => [status, statusLabel(status)]));
  const modeItems = {
    physical: t('modePhysical'),
    digital: t('modeDigital'),
  };
  const linkTypeLabel = (type: LinkType) =>
    t(
      type === 'tickets'
        ? 'linkTickets'
        : type === 'registration'
          ? 'linkRegistration'
          : type === 'info'
            ? 'linkInfo'
            : type === 'facebook'
              ? 'linkFacebook'
              : 'linkInstagram',
    );
  const linkTypeItems = Object.fromEntries(LINK_TYPES.map((type) => [type, linkTypeLabel(type)]));

  function renderAlerts() {
    return (
      <>
        {notice ? (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {saveError ? (
          <Alert variant="destructive">
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
      </>
    );
  }

  function renderSaveButton() {
    return (
      <Button type="submit" disabled={save.isPending} className="self-start">
        {save.isPending ? <Spinner data-icon="inline-start" /> : null}
        {save.isPending ? t('saving') : t('save')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/events/manage"
        className={cn(buttonVariants({ variant: 'ghost' }), 'self-start')}
      >
        {t('back')}
      </Link>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {event && canRescanImportedEvent(event) ? (
          <Button
            type="button"
            variant="outline"
            disabled={rescan.isPending || save.isPending}
            onClick={() => {
              setNotice(null);
              setFormError(null);
              rescan.mutate();
            }}
          >
            {rescan.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t('rescan')}
          </Button>
        ) : null}
      </div>
      {event ? (
        <p className="text-sm text-muted-foreground">
          {t('publisher')}:{' '}
          {event.publisherId ? (
            <Link
              href={`/publishers/${event.publisherId}`}
              className="underline underline-offset-4"
            >
              {event.publisherName}
            </Link>
          ) : (
            event.publisherName || '—'
          )}
          {' · '}
          {t('origin')}: {event.origin}
          {event.refId ? (
            <>
              {' · '}
              {t('refId')}: {event.refId}
            </>
          ) : null}
          {source ? (
            <>
              {' · '}
              <a
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                {t('source')}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {event?.meta.possibleDuplicate ? (
        <Alert>
          <AlertDescription>
            {event.meta.possibleDuplicate.workerId || event.meta.possibleDuplicate.refId
              ? t('possibleDuplicate', {
                  matchedOn: event.meta.possibleDuplicate.matchedOn,
                  worker: event.meta.possibleDuplicate.workerId ?? '',
                  ref: event.meta.possibleDuplicate.refId ?? '',
                })
              : t('possibleDuplicateSame', {
                  matchedOn: event.meta.possibleDuplicate.matchedOn,
                })}{' '}
            <Link
              href={`/events/${event.meta.possibleDuplicate.eventId}`}
              className="underline underline-offset-4"
            >
              {event.meta.possibleDuplicate.title}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {event?.meta.mergedDuplicates && event.meta.mergedDuplicates.length > 0 ? (
        <Alert>
          <AlertDescription>
            {t('mergedWith')}{' '}
            {event.meta.mergedDuplicates.map((item, index) => (
              <span key={item.eventId}>
                {index > 0 ? ', ' : null}
                <Link href={`/events/${item.eventId}`} className="underline underline-offset-4">
                  {item.title}
                </Link>
              </span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      {event?.meta.duplicateOf ? (
        <Alert>
          <AlertDescription>
            {t('duplicateOf')}{' '}
            <Link
              href={`/events/${event.meta.duplicateOf.eventId}`}
              className="underline underline-offset-4"
            >
              {event.meta.duplicateOf.title}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <Tabs
        className="gap-4"
        value={activeTab}
        onValueChange={(value) => {
          if (isEditorTab(value)) setTab(value);
        }}
      >
        <TabsList aria-label={t('tabsLabel')}>
          <TabsTrigger value="info">{t('tabInfo')}</TabsTrigger>
          <TabsTrigger value="location">{t('tabLocation')}</TabsTrigger>
          <TabsTrigger value="notifications">{t('tabNotifications')}</TabsTrigger>
          <TabsTrigger value="scan">{t('tabScan')}</TabsTrigger>
          {showOccasions ? <TabsTrigger value="occasions">{t('tabOccasions')}</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="info">
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            {renderAlerts()}
            <EventImages imageUrl={event?.imageUrl ?? null} imageUrls={event?.imageUrls ?? []} />
            <Field>
              <FieldLabel htmlFor="event-title">{t('name')}</FieldLabel>
              <Input
                id="event-title"
                required
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="event-description">{t('description')}</FieldLabel>
              <Textarea
                id="event-description"
                rows={4}
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="event-mode">{t('mode')}</FieldLabel>
                <Select
                  items={modeItems}
                  value={form.mode}
                  onValueChange={(next) => {
                    if (next == null) return;
                    update('mode', next === 'digital' ? 'digital' : 'physical');
                  }}
                >
                  <SelectTrigger id="event-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="physical">{t('modePhysical')}</SelectItem>
                      <SelectItem value="digital">{t('modeDigital')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="event-status">{t('status')}</FieldLabel>
                {form.status === 'pending_scan' ? (
                  <Input id="event-status" value={statusLabel('pending_scan')} readOnly />
                ) : (
                  <Select
                    items={statusItems}
                    value={form.status}
                    onValueChange={(next) => {
                      if (next == null || !STATUSES.includes(next as EventStatus)) return;
                      update('status', next as EventStatus);
                    }}
                  >
                    <SelectTrigger id="event-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {statusLabel(status)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </div>
            <Field orientation="horizontal">
              <Switch
                id="event-featured"
                checked={form.featured}
                onCheckedChange={(checked) => update('featured', checked)}
              />
              <FieldLabel htmlFor="event-featured">{t('featured')}</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="event-sponsored"
                checked={form.sponsored}
                onCheckedChange={(checked) => update('sponsored', checked)}
              />
              <FieldLabel htmlFor="event-sponsored">{t('sponsored')}</FieldLabel>
            </Field>
            <EventPoster eventId={eventId} posterUrl={event?.posterUrl ?? null} />
            <Field orientation="horizontal">
              <Switch
                id="event-check-in"
                checked={form.checkInEnabled}
                onCheckedChange={(checked) => update('checkInEnabled', checked)}
              />
              <FieldLabel htmlFor="event-check-in">{t('checkInEnabled')}</FieldLabel>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-disabled={timesOnOccasions || undefined}>
                <FieldLabel htmlFor="event-starts">{t('startsAt')}</FieldLabel>
                <Input
                  id="event-starts"
                  type="datetime-local"
                  required={!timesOnOccasions}
                  disabled={timesOnOccasions}
                  value={form.startsAt}
                  onChange={(e) => update('startsAt', e.target.value)}
                />
              </Field>
              <Field data-disabled={timesOnOccasions || undefined}>
                <FieldLabel htmlFor="event-ends">{t('endsAt')}</FieldLabel>
                <Input
                  id="event-ends"
                  type="datetime-local"
                  required={!timesOnOccasions}
                  disabled={timesOnOccasions}
                  value={form.endsAt}
                  onChange={(e) => update('endsAt', e.target.value)}
                />
                {timesOnOccasions ? (
                  <FieldDescription>{t('editOnOccasions')}</FieldDescription>
                ) : null}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="event-timezone">{t('timezone')}</FieldLabel>
              <Input
                id="event-timezone"
                required
                value={form.timezone}
                onChange={(e) => update('timezone', e.target.value)}
              />
              <FieldDescription>{t('timezoneHint')}</FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="event-price">{t('priceAmount')}</FieldLabel>
                <Input
                  id="event-price"
                  inputMode="numeric"
                  value={form.priceAmount}
                  onChange={(e) => update('priceAmount', e.target.value)}
                />
                <FieldDescription>{t('priceHint')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="event-currency">{t('currency')}</FieldLabel>
                <Input
                  id="event-currency"
                  maxLength={3}
                  value={form.currency}
                  onChange={(e) => update('currency', e.target.value)}
                />
              </Field>
            </div>
            <EventTagsField
              tags={categories.data?.items ?? []}
              selectedIds={form.tagIds}
              disabled={categories.isLoading || categories.isError}
              onChange={(ids) => update('tagIds', ids)}
            />
            <Card>
              <CardHeader>
                <CardTitle>{t('links')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {form.links.map((link, index) => (
                  <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Field className="w-full min-w-40 sm:w-40">
                      <FieldLabel htmlFor={`link-type-${index}`}>{t('linkType')}</FieldLabel>
                      <Select
                        items={linkTypeItems}
                        value={link.type}
                        onValueChange={(next) => {
                          if (next == null || !LINK_TYPES.includes(next as LinkType)) return;
                          const type = next as LinkType;
                          update(
                            'links',
                            form.links.map((item, i) => (i === index ? { ...item, type } : item)),
                          );
                        }}
                      >
                        <SelectTrigger id={`link-type-${index}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {LINK_TYPES.map((type) => (
                              <SelectItem key={type} value={type}>
                                {linkTypeLabel(type)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field className="min-w-0 flex-1">
                      <FieldLabel htmlFor={`link-url-${index}`}>{t('linkUrl')}</FieldLabel>
                      <Input
                        id={`link-url-${index}`}
                        value={link.url}
                        onChange={(e) =>
                          update(
                            'links',
                            form.links.map((item, i) =>
                              i === index ? { ...item, url: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field className="sm:w-48">
                      <FieldLabel htmlFor={`link-label-${index}`}>{t('linkLabel')}</FieldLabel>
                      <Input
                        id={`link-label-${index}`}
                        value={link.label}
                        onChange={(e) =>
                          update(
                            'links',
                            form.links.map((item, i) =>
                              i === index ? { ...item, label: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('removeLink')}
                      onClick={() =>
                        update(
                          'links',
                          form.links.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  onClick={() =>
                    update('links', [...form.links, { type: 'info', url: '', label: '' }])
                  }
                >
                  {t('addLink')}
                </Button>
              </CardContent>
            </Card>
            {renderSaveButton()}
          </form>
        </TabsContent>
        <TabsContent value="location">
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            {renderAlerts()}
            {form.mode === 'physical' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('physicalDetails')}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <EventLocationMap
                    lat={form.lat}
                    lng={form.lng}
                    radiusM={form.geofenceRadiusM}
                    onPlace={(lat, lng) => setDraft({ ...form, lat, lng })}
                  />
                  <Field data-disabled={timesOnOccasions || undefined}>
                    <FieldLabel htmlFor="event-venue">{t('venueName')}</FieldLabel>
                    <Input
                      id="event-venue"
                      disabled={timesOnOccasions}
                      value={form.venueName}
                      onChange={(e) => update('venueName', e.target.value)}
                    />
                    {timesOnOccasions ? (
                      <FieldDescription>{t('editOnOccasions')}</FieldDescription>
                    ) : null}
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="event-lat">{t('latitude')}</FieldLabel>
                      <Input
                        id="event-lat"
                        inputMode="decimal"
                        value={form.lat}
                        onChange={(e) => update('lat', e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="event-lng">{t('longitude')}</FieldLabel>
                      <Input
                        id="event-lng"
                        inputMode="decimal"
                        value={form.lng}
                        onChange={(e) => update('lng', e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="event-radius">{t('geofenceRadiusM')}</FieldLabel>
                    <Input
                      id="event-radius"
                      inputMode="numeric"
                      value={form.geofenceRadiusM}
                      onChange={(e) => update('geofenceRadiusM', e.target.value)}
                    />
                  </Field>
                </CardContent>
              </Card>
            ) : (
              <Field>
                <FieldLabel htmlFor="event-online">{t('onlineUrl')}</FieldLabel>
                <Input
                  id="event-online"
                  type="url"
                  required
                  value={form.onlineUrl}
                  onChange={(e) => update('onlineUrl', e.target.value)}
                />
              </Field>
            )}
            {renderSaveButton()}
          </form>
        </TabsContent>
        <TabsContent value="notifications">
          {event ? (
            <EventNotifications
              eventId={eventId}
              title={event.title}
              startsAt={event.startsAt}
              timezone={event.timezone}
              status={event.status}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="scan">
          <EventScan output={event?.llmOutput ?? null} />
        </TabsContent>
        {showOccasions && event ? (
          <TabsContent value="occasions">
            <EventOccasions
              eventId={eventId}
              occasions={event.occasions}
              possibleOccasionGroupId={event.meta.possibleOccasionGroupId}
              timeZone={event.timezone}
              onSaved={() => {
                setDraft(null);
                setNotice(t('occasionSaved'));
                setFormError(null);
              }}
              onCollapsed={() => {
                setDraft(null);
                setNotice(t('collapsed'));
                setFormError(null);
              }}
              onMerged={(occasions) => {
                setDraft(null);
                setNotice(occasions === 'move' ? t('mergedOccasions') : t('merged'));
                setFormError(null);
              }}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

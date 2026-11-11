import { randomUUID } from 'node:crypto';
import { readScanInstructions } from '@local-events/ingest';
import {
  choosePossibleOccasionGroupId,
  importedVenueName,
  importPlanToSchedule,
  occasionsToAdd,
  OCCASION_GROUP_MIN_RANK,
  shouldEnqueueNotifications,
  addressRankReplaces,
  resolveImportCity,
  sourceCity,
  statusAfterImportScan,
  venueIdentity,
  venueNameFromScan,
} from '@local-events/domain';
import { cityFromPoint, cityGeocodeOptions, geocodeSwedishAddress } from './page-place';
import { attachScanLog, formatScanLog } from './scan-log';
import { failFinishedScan, type ScanProgress } from './scan-progress';
import { emitDomainEvent, noopDomainEvents, type DomainEventSink } from './domain-events';
import type { PromptRunner, ScanInput, ScanOutcome } from './prompt-runners';
import type { IngestStore, PendingScanRow, PublisherLink } from './store';

export const SCAN_BATCH_LIMIT = 5;
/** Long enough for one Ollama call per event in the batch. */
export const SCAN_LEASE_MS = 10 * 60 * 1000;

export interface ScanSummary {
  claimed: number;
  published: number;
  review: number;
  unavailable: number;
  /** Unavailable rows whose chat request timed out. Already included in `unavailable`. */
  unavailable_timeout: number;
  skipped: number;
  /** Rows this call claimed, including ones the model could not finish. */
  eventIds: string[];
}

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Geocode lines written before the model runs. The same row is passed to applyOutcome. */
const placeNotes = new WeakMap<PendingScanRow, string[]>();

function notesFor(row: PendingScanRow): string[] {
  const existing = placeNotes.get(row);
  if (existing) return existing;
  const created: string[] = [];
  placeNotes.set(row, created);
  return created;
}

function pointText(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

function eventSummary(value: string): string | null {
  const summary = value.trim();
  return summary.length > 0 ? summary : null;
}

/** The events table only stores `sv` and `en`. A blank or other code stays Swedish. */
function eventLanguage(value: string): 'sv' | 'en' {
  return value.trim().toLowerCase() === 'en' ? 'en' : 'sv';
}

/** Reads `--event` / `--limit` (or `EVENT_ID` / `SCAN_LIMIT`) for a manual scan run. */
export function parseScanSelection(input: {
  eventId?: string;
  limit?: string;
}): { ok: true; eventId?: string; limit?: number } | { ok: false; message: string } {
  if (input.eventId != null) {
    const eventId = input.eventId.trim();
    if (!EVENT_ID.test(eventId)) return { ok: false, message: '--event must be an event id' };
    const limited = parseLimit(input.limit);
    if (!limited.ok) return limited;
    return { ok: true, eventId, ...(limited.limit != null ? { limit: limited.limit } : {}) };
  }
  const limited = parseLimit(input.limit);
  if (!limited.ok) return limited;
  return { ok: true, ...(limited.limit != null ? { limit: limited.limit } : {}) };
}

function parseLimit(
  limit: string | undefined,
): { ok: true; limit?: number } | { ok: false; message: string } {
  const rawLimit = limit?.trim();
  if (rawLimit == null || rawLimit === '') return { ok: true };
  if (!/^[1-9]\d{0,2}$/.test(rawLimit)) {
    return { ok: false, message: '--limit must be a whole number from 1 to 999' };
  }
  return { ok: true, limit: Number(rawLimit) };
}

export async function scanPendingEvents(
  store: IngestStore,
  runner: PromptRunner,
  enqueue: DomainEventSink = noopDomainEvents,
  options: {
    limit?: number;
    leaseMs?: number;
    eventId?: string;
    skipEventIds?: readonly string[];
    fetch?: typeof fetch;
    /** RunPod passes this so a save failure moves that event from done to failed. */
    progress?: ScanProgress;
  } = {},
): Promise<ScanSummary> {
  const limit = options.limit ?? SCAN_BATCH_LIMIT;
  const leaseMs = options.leaseMs ?? SCAN_LEASE_MS;
  const claimed = await store.claimPendingScans(
    limit,
    leaseMs,
    options.eventId,
    options.skipEventIds,
  );
  const summary: ScanSummary = {
    claimed: claimed.length,
    published: 0,
    review: 0,
    unavailable: 0,
    unavailable_timeout: 0,
    skipped: 0,
    eventIds: claimed.map((row) => row.eventId),
  };
  if (claimed.length === 0) return summary;
  const fetchImpl = options.fetch ?? fetch;
  const batch: ScanInput[] = [];
  const rows = new Map<string, PendingScanRow>();
  for (const row of claimed) {
    await ensureScanPoint(store, row, fetchImpl);
    const input = scanInputFor(row);
    rows.set(row.eventId, row);
    batch.push(input);
  }
  const outcomes = batch.length > 0 ? await runner.scan(batch) : [];
  const temporaries = new Map<string, PublisherLink>();
  for (const outcome of outcomes) {
    const row = rows.get(outcome.eventId);
    if (!row) continue;
    if (!outcome.ok) {
      await store.releaseScanClaim(row.eventId, row.claimedUntil);
      summary.unavailable += 1;
      if (outcome.reason === 'timeout') summary.unavailable_timeout += 1;
      else await notifyTipScan(store, enqueue, row.eventId, 'failed');
      continue;
    }
    let applied: 'published' | 'review' | 'skipped';
    try {
      applied = await applyOutcome(store, row, outcome, enqueue, temporaries, fetchImpl);
    } catch (error) {
      console.error(
        'scan apply failed',
        row.eventId,
        error instanceof Error ? error.message : error,
      );
      await store.releaseScanClaim(row.eventId, row.claimedUntil);
      summary.unavailable += 1;
      if (options.progress) failFinishedScan(options.progress);
      continue;
    }
    if (applied === 'published') summary.published += 1;
    else if (applied === 'review') summary.review += 1;
    else {
      summary.skipped += 1;
      if (options.progress) failFinishedScan(options.progress);
    }
    if (applied !== 'skipped') {
      await notifyTipScan(
        store,
        enqueue,
        row.eventId,
        applied === 'published' ? 'published' : 'in_review',
      );
    }
  }
  return summary;
}

async function notifyTipScan(
  store: IngestStore,
  enqueue: DomainEventSink,
  eventId: string,
  status: 'published' | 'in_review' | 'failed',
): Promise<void> {
  const marked = await store.markTipScanned({ eventId, status, now: new Date() });
  if (!marked) return;
  await emitDomainEvent(enqueue, {
    type: 'tip.scanned',
    tipId: marked.tipId,
    eventId,
    status,
  });
}

/** A user tip is passed as `tip`. The written description stays a separate field. */
function scanDescription(row: PendingScanRow): Pick<ScanInput, 'description' | 'tip'> {
  const text = row.meta.tip?.text?.trim();
  const categoryHint = row.meta.tip?.categoryHint?.trim();
  return {
    ...(row.description ? { description: row.description } : {}),
    ...(text || categoryHint
      ? {
          tip: {
            ...(text ? { text } : {}),
            ...(categoryHint ? { categoryHint } : {}),
          },
        }
      : {}),
  };
}

export function scanInputFor(row: PendingScanRow): ScanInput {
  const organizerKeys = row.meta.import?.organizerKeys ?? [];
  const venue = importedVenueName(row.meta.import);
  return {
    eventId: row.eventId,
    title: row.title,
    ...scanDescription(row),
    ...(venue ? { venue } : {}),
    ...(row.meta.address?.address ? { placeLine: row.meta.address.address } : {}),
    ...(row.meta.address?.city ? { placeCity: row.meta.address.city } : {}),
    startsAt: row.startsAt?.toISOString() ?? '',
    endsAt: row.endsAt?.toISOString() ?? '',
    ...(row.location ? { location: row.location } : {}),
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    links: row.links,
    pageLinks: row.pageLinks,
    externalId: row.externalId,
    workerId: row.workerId,
    existingTags: row.tags,
    source: { id: row.sourceId, slug: row.sourceSlug, trust: row.sourceTrust },
    organizer: {
      keys: organizerKeys,
      ...(row.meta.import?.organizerName ? { name: row.meta.import.organizerName } : {}),
    },
  };
}

export async function applyOutcome(
  store: IngestStore,
  row: PendingScanRow,
  outcome: Extract<ScanOutcome, { ok: true }>,
  enqueue: DomainEventSink,
  temporaries: Map<string, PublisherLink>,
  fetchImpl: typeof fetch,
  persist: (input: Parameters<IngestStore['finishImportedScan']>[0]) => Promise<boolean> = (
    input,
  ) => store.finishImportedScan(input),
): Promise<'published' | 'review' | 'skipped'> {
  const publisher = await publisherFor(store, row, outcome, temporaries);
  const status = statusAfterImportScan({
    approved: outcome.approved,
    publisherStatus: publisher.status,
    publisherIsTemporary: publisher.isTemporary,
    sourceTrust: row.sourceTrust,
    possibleDuplicate: outcome.duplicate !== null,
  });
  const tagIds = await store.tagIdsForExternalIds(outcome.tags.map((tag) => tag.externalId));
  const meta = { ...row.meta };
  if (outcome.duplicate) meta.possibleDuplicate = outcome.duplicate;
  else delete meta.possibleDuplicate;
  const instructions = readScanInstructions(outcome.instructions);
  if (instructions.length > 0) meta.instructions = instructions;
  else delete meta.instructions;
  const group = await occasionGroupFor(store, row, outcome.occasionMatches ?? []);
  let occasionGroup = 'No occasion group.';
  if (group) {
    meta.possibleOccasionGroupId = group.groupId;
    await store.setPossibleOccasionGroup(group.memberIds, group.groupId);
    occasionGroup = `Occasion group ${group.groupId} on ${group.memberIds.join(', ')}.`;
  } else {
    const stored = await store.listOccasionGroups([row.eventId]);
    const kept = stored[0]?.possibleOccasionGroupId;
    if (kept) {
      meta.possibleOccasionGroupId = kept;
      occasionGroup = `Kept occasion group ${kept}.`;
    }
  }
  const occasions = occasionsFromScan(outcome);
  const before = {
    point: row.location ?? undefined,
    placeLine: row.meta.address?.address,
    placeCity: row.meta.address?.city,
  };
  const lookups = notesFor(row);
  const place = await placeFromScan(store, row, outcome, fetchImpl, lookups);
  let venueCity = place.replacesStored ? place.address?.city : row.meta.address?.city;
  if (!venueCity) venueCity = place.address?.city;
  const venueName = venueNameFromScan(outcome.possibleVenueNames, row.meta.import, venueCity);
  let identity = venueIdentity(venueName, venueCity);
  let known = identity ? await store.findVenue(identity.nameKey, identity.cityKey) : null;
  if (known && !row.location && !place.replacesStored) row.location = known.location;
  const location = place.location ?? row.location ?? known?.location;
  if (!identity && venueName && location) {
    if (!venueCity) {
      lookups.push(`Look up the town for point ${pointText(location)}.`);
      venueCity = await cityFromPoint(location, fetchImpl);
      lookups.push(venueCity ? `The point is in ${venueCity}.` : 'The point did not match a town.');
    }
    identity = venueIdentity(venueName, venueCity);
    if (identity) known = await store.findVenue(identity.nameKey, identity.cityKey);
  }
  let venueId = known?.id;
  const venueStreet = place.address ?? row.meta.address;
  if (identity && location) {
    const savedVenue = await store.saveVenue({
      ...identity,
      location,
      ...(venueStreet?.address ? { address: venueStreet.address } : {}),
      ...(venueStreet?.zipCode ? { zipCode: venueStreet.zipCode } : {}),
    });
    venueId = savedVenue.id;
  }
  if (place.address) {
    meta.address =
      place.replacesStored && location && !place.address.location
        ? { ...place.address, location }
        : place.address;
  }
  if (venueCity && meta.address && !meta.address.city) {
    meta.address = { ...meta.address, city: venueCity };
  }
  const scanLog = formatScanLog({
    title: row.title,
    source: row.sourceSlug,
    trust: row.sourceTrust,
    placeLine: before.placeLine,
    placeCity: before.placeCity,
    storedPoint: before.point,
    outcome,
    publisher: {
      id: publisher.publisherId,
      status: publisher.status,
      isTemporary: publisher.isTemporary,
      name: outcome.publisher.kind === 'temporary' ? outcome.publisher.name : publisher.publisherId,
    },
    status,
    lookups,
    venue: venueLine(venueName, venueCity, known, venueId, location),
    point: location ?? undefined,
    addressKept: addressDecision(outcome, place, Boolean(before.point)),
    occasionGroup,
  });
  const saved = await persist({
    eventId: row.eventId,
    publisherId: publisher.publisherId,
    status,
    meta,
    tagIds,
    llmOutput: attachScanLog(outcome.llmOutput, scanLog),
    contentVerdict: outcome.contentVerdict,
    summary: eventSummary(outcome.summary),
    language: eventLanguage(outcome.language),
    claimedUntil: row.claimedUntil,
    ...(occasions.length > 0 ? { occasions } : {}),
    ...(location ? { location } : {}),
    ...(place.replacesStored && place.location ? { replaceLocation: true } : {}),
    ...(venueId ? { venueId } : {}),
    ...(venueName ? { venueName } : {}),
    ...(venueCity ? { venueCity } : {}),
  });
  if (!saved) return 'skipped';
  const startsAt = row.startsAt ?? occasions[0]?.startsAt;
  if (store.scheduleImportNotifications && startsAt) {
    const planId = importPlanToSchedule({
      publisherStatus: publisher.status,
      planId: publisher.importNotificationPlan,
    });
    if (planId) {
      await store.scheduleImportNotifications({
        eventId: row.eventId,
        eventTitle: row.title,
        startsAt,
        planId,
        notifyOnPublish: publisher.importNotifyOnPublish,
        status,
      });
    }
  }
  if (shouldEnqueueNotifications(status)) {
    await emitDomainEvent(enqueue, { type: 'event.published', eventId: row.eventId });
  }
  return status === 'published' ? 'published' : 'review';
}

/**
 * A point already on the occasion or the scraped address is kept. Otherwise the
 * scraped address is geocoded so nearby tools can use it. An address the model
 * ranks over 80 replaces that point. A lower rank is used only when the import
 * stored none. The model does not supply the point.
 */
function addressPoint(
  location: { lat: number; lng: number } | undefined,
): { lat: number; lng: number } | undefined {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    return undefined;
  }
  if (location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180) {
    return undefined;
  }
  return { lat: location.lat, lng: location.lng };
}

function isDigitalPlace(name: string | null | undefined): boolean {
  return /^(digitalt|online|webb)$/i.test(name?.trim() ?? '');
}

/**
 * Page town, then the source city, on an address the import already stored.
 * An event with no address is left empty so the scan can supply one.
 */
function fillKnownCity(row: PendingScanRow): void {
  if (!row.meta.address || row.meta.address.city || isDigitalPlace(row.venueName)) return;
  const city = resolveImportCity({
    placeText: [row.meta.address.address, row.venueName].filter(Boolean).join(', '),
    fallback: row.location ? undefined : sourceCity(row.sourceSlug),
  });
  if (!city) return;
  row.meta.address = { ...row.meta.address, city, country: row.meta.address.country ?? 'Sweden' };
}

async function ensureScanPoint(
  store: IngestStore,
  row: PendingScanRow,
  fetchImpl: typeof fetch,
): Promise<void> {
  const notes = notesFor(row);
  fillKnownCity(row);
  const city = row.meta.address?.city;
  const town = city ? await store.findKnownCity(city.toLocaleLowerCase('sv')) : null;
  const hasPlace = addressHasPlace(row.meta.address?.address, city);
  const townOnly = (point: { lat: number; lng: number } | null | undefined) =>
    Boolean(point && town && hasPlace && pointsMatch(point, town));
  if (row.location && !townOnly(row.location)) {
    notes.push(`Kept the stored point ${pointText(row.location)}.`);
    return;
  }
  const stored = addressPoint(row.meta.address?.location);
  if (stored && !townOnly(stored)) {
    row.location = stored;
    notes.push(`Kept the point already on the address, ${pointText(stored)}.`);
    return;
  }
  const known = await rememberedVenue(store, row.meta.import?.venueName, row.meta.address?.city);
  if (known && !townOnly(known.location)) {
    row.location = known.location;
    notes.push(
      `Used the stored venue "${row.meta.import?.venueName ?? ''}" at ${pointText(known.location)}.`,
    );
    return;
  }
  if (!row.meta.address) {
    if (row.location) notes.push(`Kept the stored point ${pointText(row.location)}.`);
    else notes.push('The import stored no address to look up.');
    return;
  }
  if (townOnly(row.location) || townOnly(stored)) {
    notes.push(`The stored point is the town ${city}. Looking up the address.`);
  }
  const location = await geocodeSwedishAddress(row.meta.address, fetchImpl, {
    ...cityGeocodeOptions(store),
    log: (line) => notes.push(line),
  });
  if (location) {
    row.location = location;
    row.meta.address = { ...row.meta.address, location };
    return;
  }
  if (!row.location && stored) row.location = stored;
  else notes.push('The stored address had no point before the model ran.');
}

function addressHasPlace(
  address: string | null | undefined,
  city: string | null | undefined,
): boolean {
  const text = address?.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const town = city?.toLocaleLowerCase('sv');
  return text
    .toLocaleLowerCase('sv')
    .split(/[^a-zåäö0-9]+/i)
    .some((word) => word.length > 0 && word !== town);
}

function pointsMatch(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number },
): boolean {
  return Math.abs(left.lat - right.lat) < 0.0002 && Math.abs(left.lng - right.lng) < 0.0002;
}

async function rememberedVenue(
  store: IngestStore,
  name: string | null | undefined,
  city: string | null | undefined,
): Promise<{ location: { lat: number; lng: number } } | null> {
  const identity = venueIdentity(name, city);
  if (!identity) return null;
  return store.findVenue(identity.nameKey, identity.cityKey);
}

async function placeFromScan(
  store: IngestStore,
  row: PendingScanRow,
  outcome: Extract<ScanOutcome, { ok: true }>,
  fetchImpl: typeof fetch,
  notes: string[],
): Promise<{
  location?: { lat: number; lng: number };
  address?: NonNullable<PendingScanRow['meta']['address']>;
  /** The model address was ranked over 80. The previous point stays when this address does not geocode. */
  replacesStored?: boolean;
}> {
  const geocode = (address: NonNullable<PendingScanRow['meta']['address']>) =>
    geocodeSwedishAddress(address, fetchImpl, {
      ...cityGeocodeOptions(store),
      log: (line) => notes.push(line),
    });
  const ranked = outcome.address;
  if (ranked && addressRankReplaces(ranked.rank)) {
    const chosen = {
      ...(ranked.address ? { address: ranked.address } : {}),
      ...(ranked.zipCode ? { zipCode: ranked.zipCode } : {}),
      ...(ranked.city ? { city: ranked.city } : {}),
      country: ranked.country ?? ('Sweden' as const),
    };
    const location = await geocode(chosen);
    return {
      replacesStored: true,
      ...(location ? { location } : {}),
      address: location ? { ...chosen, location } : chosen,
    };
  }
  const scraped = row.meta.address;
  const model = outcome.address ? placedAddress(outcome.address) : undefined;
  const found = scraped ?? model;
  const filledCity =
    found && !found.city && !isDigitalPlace(row.venueName)
      ? resolveImportCity({
          placeText: [found.address, row.venueName].filter(Boolean).join(', '),
          fallback: sourceCity(row.sourceSlug),
        })
      : undefined;
  const chosen = found && filledCity ? { ...found, city: filledCity } : found;
  if (row.location) {
    if (scraped) {
      return {
        location: row.location,
        address: scraped.location ? scraped : { ...scraped, location: row.location },
      };
    }
    if (chosen) return { location: row.location, address: chosen };
    return { location: row.location };
  }
  if (!chosen) return {};
  const location = await geocode(chosen);
  const address = location ? { ...chosen, location } : chosen;
  return {
    ...(location ? { location } : {}),
    address,
  };
}

function addressDecision(
  outcome: Extract<ScanOutcome, { ok: true }>,
  place: { replacesStored?: boolean; location?: { lat: number; lng: number } },
  hadPoint: boolean,
): string {
  const rank = outcome.address?.rank;
  if (place.replacesStored && place.location) {
    return `Address rank ${rank} replaced the stored address and point.`;
  }
  if (place.replacesStored) {
    return hadPoint
      ? `Address rank ${rank} replaced the stored address. Geocoding found no point, so the previous point stays.`
      : `Address rank ${rank} replaced the stored address. Geocoding found no point.`;
  }
  if (outcome.address) {
    return `Address rank ${rank ?? 'none'} did not replace the stored address.`;
  }
  return 'The model returned no address.';
}

function venueLine(
  venueName: string | undefined,
  venueCity: string | null | undefined,
  known: { id: string } | null,
  venueId: string | undefined,
  location: { lat: number; lng: number } | null | undefined,
): string {
  if (!venueName) return 'No venue name was saved.';
  const town = venueCity || 'an unknown town';
  if (known) return `Venue "${venueName}" in ${town} was already stored.`;
  if (venueId) return `Venue "${venueName}" in ${town} was saved.`;
  if (!location) return `Venue "${venueName}" was not saved because it has no point.`;
  return `Venue "${venueName}" was not saved.`;
}

/** The stored address. The model's rank is not part of that record. */
function placedAddress(
  address: NonNullable<Extract<ScanOutcome, { ok: true }>['address']>,
): NonNullable<PendingScanRow['meta']['address']> {
  const { rank: _rank, ...stored } = address;
  return stored;
}

/**
 * Showings from the scan. `possibleOccasions` wins. An older outcome that only
 * set `startsAt` and `endsAt` is one showing. A one-sided range is dropped.
 * The earliest start is first, so a notification can use it when the event has none.
 */
function occasionsFromScan(
  outcome: Extract<ScanOutcome, { ok: true }>,
): { startsAt: Date; endsAt: Date; venueName: string | null }[] {
  const listed =
    outcome.possibleOccasions ??
    (outcome.startsAt && outcome.endsAt
      ? [{ startsAt: outcome.startsAt, endsAt: outcome.endsAt }]
      : []);
  const occasions: { startsAt: Date; endsAt: Date; venueName: string | null }[] = [];
  for (const item of listed) {
    const startsAt = new Date(item.startsAt);
    const endsAt = new Date(item.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) continue;
    if (endsAt.getTime() < startsAt.getTime()) continue;
    const raw = 'venueName' in item ? item.venueName : undefined;
    const venueName = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    occasions.push({ startsAt, endsAt, venueName: venueName || null });
  }
  return occasionsToAdd([], occasions).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Reuses an occasion id already stored on this event or a high-ranked duplicate.
 * A new id is written onto each of those duplicates. This event receives it
 * through the scan meta, because finishing the scan replaces that object.
 */
async function occasionGroupFor(
  store: IngestStore,
  row: PendingScanRow,
  matches: { eventId: string; occasionRank: number }[],
): Promise<{ groupId: string; memberIds: string[] } | null> {
  const known = matches.filter(
    (match) => EVENT_ID.test(match.eventId) && match.eventId !== row.eventId,
  );
  if (known.length === 0) return null;
  const stored = await store.listOccasionGroups([
    row.eventId,
    ...known.map((match) => match.eventId),
  ]);
  const byId = new Map(stored.map((item) => [item.eventId, item]));
  const self = byId.get(row.eventId);
  const possibleOccasionGroupId = self?.possibleOccasionGroupId ?? row.meta.possibleOccasionGroupId;
  const duplicates = known.flatMap((match) => {
    const existing = byId.get(match.eventId);
    if (!existing) return [];
    return [
      {
        occasionRank: match.occasionRank,
        ...(existing.possibleOccasionGroupId
          ? { possibleOccasionGroupId: existing.possibleOccasionGroupId }
          : {}),
      },
    ];
  });
  const groupId = choosePossibleOccasionGroupId({
    event: {
      ...(possibleOccasionGroupId ? { possibleOccasionGroupId } : {}),
    },
    duplicates,
    newId: randomUUID(),
  });
  if (!groupId) return null;
  const memberIds = known
    .filter((match) => match.occasionRank > OCCASION_GROUP_MIN_RANK && byId.has(match.eventId))
    .map((match) => match.eventId);
  return { groupId, memberIds };
}

async function publisherFor(
  store: IngestStore,
  row: PendingScanRow,
  outcome: Extract<ScanOutcome, { ok: true }>,
  temporaries: Map<string, PublisherLink>,
): Promise<PublisherLink> {
  if (outcome.publisher.kind === 'temporary') {
    const keys = outcome.publisher.organizerKeys;
    for (const [stored, publisher] of temporaries) {
      const storedKeys = stored.split('\n');
      if (!keys.some((key) => storedKeys.includes(key))) continue;
      await store.rememberOrganizerKeys(row.sourceId, publisher.publisherId, keys);
      temporaries.delete(stored);
      temporaries.set([...new Set([...storedKeys, ...keys])].join('\n'), publisher);
      return publisher;
    }
    const created = await store.createTemporaryPublisher({
      sourceId: row.sourceId,
      organizerKeys: keys,
      name: outcome.publisher.name,
    });
    temporaries.set(keys.join('\n'), created);
    return created;
  }
  await store.rememberOrganizerKeys(
    row.sourceId,
    outcome.publisher.publisherId,
    row.meta.import?.organizerKeys ?? [],
  );
  return {
    publisherId: outcome.publisher.publisherId,
    isTemporary: outcome.publisher.isTemporary,
    status: outcome.publisher.status,
    importNotificationPlan: outcome.publisher.importNotificationPlan,
    importNotifyOnPublish: outcome.publisher.importNotifyOnPublish,
  };
}

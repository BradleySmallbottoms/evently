import { organizerKeys } from './organizer-keys';
import { stockholmWallTime } from './source-time';

/** Free-text step on the tip screen. */
export const TIP_TEXT_MAX = 500;
/** Poster upload cap. Matches the event image copier. */
export const TIP_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const TIP_IMAGE_MAX_COUNT = 4;
/** Submitted tips per user, rolling 24 hours. Also the cap on unfinished tips. */
export const TIP_DAILY_LIMIT = 10;
/** Profile list page size. */
export const TIP_LIST_LIMIT = 100;
/** Base64 length of an 8 MB poster. The upload body is rejected at this size. */
export const TIP_IMAGE_BASE64_MAX = Math.ceil(TIP_IMAGE_MAX_BYTES / 3) * 4;
/** A vision read still marked scanning after this is started again. */
export const TIP_VISION_STALE_MS = 30_000;

export const TIP_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export type TipImageType = (typeof TIP_IMAGE_TYPES)[number];
export type TipPath = 'photo' | 'text';
export type TipStatus = 'collecting' | 'needs_input' | 'submitted' | 'scanned' | 'failed';
export type TipLocale = 'sv' | 'en';

/** Fields the model may fill. Empty string and null mean unknown. */
export interface TipExtraction {
  title?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  place?: string | null;
  priceLabel?: string | null;
  /** Minor units. 0 is free. Null is unknown. */
  priceAmount?: number | null;
  link?: string | null;
  organizerName?: string | null;
  description?: string | null;
  /** One or two sentences written once the required facts are present. */
  summary?: string | null;
  categoryHint?: string | null;
  /** Tag names the model chose from the catalog. */
  tags?: string[] | null;
  /** The person said there is no link. The card stays empty. */
  linkDeclined?: boolean | null;
  /** Clock on the start, `HH:MM`, when it is known apart from `startsAt`. */
  startTime?: string | null;
  /** Clock on the end, `HH:MM`, when it is known apart from `endsAt`. */
  endTime?: string | null;
  /** The person does not know the start time. */
  startTimeDeclined?: boolean | null;
  /** The person does not know the end time. */
  endTimeDeclined?: boolean | null;
  /** The person does not know when the event ends. */
  endDeclined?: boolean | null;
  /** The person said there is no picture. */
  imageDeclined?: boolean | null;
}

export interface TipCard {
  title: string | null;
  startsAt: string | null;
  place: string | null;
  priceLabel: string | null;
  link: string | null;
  endsAt: string | null;
  summary: string | null;
  tags: string[];
}

export type TipPhase =
  | 'collecting'
  | 'scanning'
  | 'confirm'
  | 'follow_up'
  | 'receipt'
  | 'published'
  | 'review'
  | 'failed';

const FREE_PRICE = /^(gratis|fri entré|fritt inträde|kostnadsfritt|free)$/i;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function emptyTipExtraction(): TipExtraction {
  return {
    title: null,
    startsAt: null,
    endsAt: null,
    startTime: null,
    endTime: null,
    place: null,
    priceLabel: null,
    priceAmount: null,
    link: null,
    organizerName: null,
    description: null,
    summary: null,
    categoryHint: null,
    tags: null,
    linkDeclined: null,
    startTimeDeclined: null,
    endTimeDeclined: null,
    endDeclined: null,
    imageDeclined: null,
  };
}

/** Later non-empty values replace earlier ones. Null does not wipe a filled field. */
export function mergeTipExtraction(base: TipExtraction, patch: TipExtraction): TipExtraction {
  const next = { ...emptyTipExtraction(), ...base };
  for (const key of Object.keys(emptyTipExtraction()) as (keyof TipExtraction)[]) {
    const value = patch[key];
    if (key === 'priceAmount' && typeof value === 'number' && Number.isFinite(value)) {
      next.priceAmount = Math.max(0, Math.round(value));
      continue;
    }
    if (
      key === 'linkDeclined' ||
      key === 'imageDeclined' ||
      key === 'startTimeDeclined' ||
      key === 'endTimeDeclined' ||
      key === 'endDeclined'
    ) {
      if (typeof value === 'boolean') next[key] = value;
      continue;
    }
    if (key === 'tags' && Array.isArray(value)) {
      next.tags = value
        .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
        .map((tag) => tag.trim())
        .slice(0, 8);
      continue;
    }
    if (key === 'link' && typeof value === 'string') {
      const bare = bareTipLink(value);
      if (bare) next.link = bare;
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      (next[key] as string | null) = value.trim();
    }
  }
  if (next.priceAmount == null && next.priceLabel && FREE_PRICE.test(next.priceLabel)) {
    next.priceAmount = 0;
  }
  return next;
}

/** Facts the chat must collect before the confirm card. */
export const TIP_DETAILS = [
  'title',
  'startsAt',
  'startTime',
  'endsAt',
  'endTime',
  'place',
  'price',
  'link',
  'description',
] as const;

export type TipDetail = (typeof TIP_DETAILS)[number];

/** Keys the model uses. Start and end are each a date and a time. */
export const TIP_FACT_KEYS = [
  'title',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'place',
  'price',
  'link',
  'description',
] as const;

export type TipFactKey = (typeof TIP_FACT_KEYS)[number];

/** `date` and `end` remain so a chat already in progress can still read its question. */
export const TIP_ASK_KEYS = [...TIP_FACT_KEYS, 'date', 'end', 'image'] as const;

export type TipAskKey = (typeof TIP_ASK_KEYS)[number];

/** A button under a bot question. `reply` null opens a text field. */
export interface TipAskOption {
  label: string;
  reply: string | null;
}

export interface TipFollowUp {
  key: TipAskKey;
  question: string;
  options?: TipAskOption[];
}

const DETAIL_KEY: Record<TipDetail, TipAskKey> = {
  title: 'title',
  startsAt: 'startDate',
  startTime: 'startTime',
  endsAt: 'endDate',
  endTime: 'endTime',
  place: 'place',
  price: 'price',
  link: 'link',
  description: 'description',
};

const ASK_DETAIL: Record<TipAskKey, TipDetail | null> = {
  title: 'title',
  startDate: 'startsAt',
  date: 'startsAt',
  startTime: 'startTime',
  endDate: 'endsAt',
  end: 'endsAt',
  endTime: 'endTime',
  place: 'place',
  price: 'price',
  link: 'link',
  description: 'description',
  image: null,
};

function detailForAsk(key: TipAskKey): TipDetail | null {
  return ASK_DETAIL[key];
}

const TIP_DETAIL_QUESTION: Record<TipDetail, Record<TipLocale, string>> = {
  title: { sv: 'Vad heter evenemanget?', en: 'What is the event called?' },
  startsAt: { sv: 'Vilket datum börjar evenemanget?', en: 'What date does the event start?' },
  startTime: { sv: 'Vilken tid börjar det?', en: 'What time does it start?' },
  endsAt: { sv: 'Vilket datum slutar evenemanget?', en: 'What date does the event end?' },
  endTime: { sv: 'Vilken tid slutar det?', en: 'What time does it end?' },
  place: { sv: 'Var är evenemanget?', en: 'Where is the event?' },
  price: { sv: 'Vad kostar det?', en: 'What does it cost?' },
  link: { sv: 'Finns det en länk?', en: 'Is there a link?' },
  description: { sv: 'Kan du beskriva det kort?', en: 'Can you describe it briefly?' },
};

export function isTipAskKey(value: unknown): value is TipAskKey {
  return typeof value === 'string' && (TIP_ASK_KEYS as readonly string[]).includes(value);
}

function detailFilled(detail: TipDetail, extraction: TipExtraction): boolean {
  if (detail === 'title') return hasUsableTitle(extraction);
  if (detail === 'price')
    return extraction.priceAmount != null || Boolean(clean(extraction.priceLabel));
  if (detail === 'link') {
    if (extraction.linkDeclined) return true;
    return bareTipLink(extraction.link) != null;
  }
  if (detail === 'startsAt') return calendarDay(extraction.startsAt) != null;
  if (detail === 'startTime') {
    if (extraction.startTimeDeclined) return true;
    return clockOf(extraction.startTime) != null;
  }
  if (detail === 'endsAt')
    return extraction.endDeclined === true || calendarDay(extraction.endsAt) != null;
  if (detail === 'endTime') {
    if (extraction.endDeclined || extraction.endTimeDeclined) return true;
    return clockOf(extraction.endTime) != null;
  }
  return Boolean(clean(extraction[detail]));
}

function kronorMinor(raw: string): number | null {
  const match = raw.match(/^(\d{1,6})(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  const major = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0') || '0');
  if (major > 100_000) return null;
  return major * 100 + fraction;
}

/** Names or ids from the model, kept only when they are in the catalog. */
export function tipTags(raw: unknown, catalog: readonly { id: string; name: string }[]): string[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(catalog.map((tag) => [tag.id, tag.name]));
  const byName = new Map(catalog.map((tag) => [tag.name.toLowerCase(), tag.name]));
  const picked: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const name = (byId.get(item.trim()) ?? byName.get(item.trim().toLowerCase()))?.slice(0, 80);
    if (!name || picked.includes(name)) continue;
    picked.push(name);
    if (picked.length === 8) break;
  }
  return picked;
}

/** Host and path only. `https://stad.se/konsert` becomes `stad.se/konsert`. */
export function bareTipLink(raw: string | null | undefined): string | null {
  let value = clean(raw) ?? '';
  value = value.replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
  if (!value || /\s/.test(value) || !value.includes('.')) return null;
  return value.slice(0, 500);
}

/** A model button is kept only when its reply is empty or a link or end line. */
export function tipAskOptions(key: TipAskKey, raw: unknown): TipAskOption[] {
  if (!Array.isArray(raw)) return [];
  const options: TipAskOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { label?: unknown; reply?: unknown };
    if (typeof record.label !== 'string' || !record.label.trim()) continue;
    const reply = tipAskReply(key, typeof record.reply === 'string' ? record.reply : null);
    if (record.reply != null && record.reply !== '' && reply == null) continue;
    options.push({ label: record.label.trim().slice(0, 40), reply });
    if (options.length === 4) break;
  }
  return options;
}

function tipAskReply(key: TipAskKey, raw: string | null): string | null {
  const line = raw?.trim() ?? '';
  if (!line) return null;
  if (key === 'link') {
    if (/^link:\s*none$/i.test(line)) return 'link: none';
    const rest = line.match(/^link:\s*(\S+)$/i)?.[1];
    const bare = rest ? bareTipLink(rest) : null;
    return bare ? `link: ${bare}` : null;
  }
  if (key === 'startDate' || key === 'date') {
    const rest = line.replace(/^(?:startDate|date):\s*/i, '');
    return calendarDay(rest) ? `${key}: ${rest}` : null;
  }
  if (key === 'startTime') return timeReply('startTime', line);
  if (key === 'endTime') return timeReply('endTime', line);
  if (key === 'endDate') {
    if (/^endDate:\s*none$/i.test(line) || /^end:\s*none$/i.test(line)) return 'endDate: none';
    const rest = line.replace(/^endDate:\s*/i, '');
    return calendarDay(rest) ? `endDate: ${rest}` : null;
  }
  if (key === 'end') {
    if (/^end:\s*none$/i.test(line)) return 'end: none';
    const rest = line.replace(/^end:\s*/i, '');
    const value = tipEndValue(rest);
    return value ? `end: ${value}` : null;
  }
  return null;
}

function timeReply(key: 'startTime' | 'endTime', line: string): string | null {
  if (new RegExp(`^${key}:\\s*none$`, 'i').test(line)) return `${key}: none`;
  const rest = line.replace(new RegExp(`^${key}:\\s*`, 'i'), '');
  const clock = clockOf(rest);
  return clock ? `${key}: ${clock}` : null;
}

const END_UNKNOWN: Record<TipLocale, TipAskOption> = {
  sv: { label: 'Jag vet inte', reply: 'endDate: none' },
  en: { label: "I don't know", reply: 'endDate: none' },
};

const START_TIME_UNKNOWN: Record<TipLocale, TipAskOption> = {
  sv: { label: 'Jag vet inte', reply: 'startTime: none' },
  en: { label: "I don't know", reply: 'startTime: none' },
};

const END_TIME_UNKNOWN: Record<TipLocale, TipAskOption> = {
  sv: { label: 'Jag vet inte', reply: 'endTime: none' },
  en: { label: "I don't know", reply: 'endTime: none' },
};

/** Date, time, or both. A clock alone stays `HH:MM` until a start date can place it. */
export function tipEndValue(raw: string | null | undefined, start?: string | null): string | null {
  const value = clean(raw);
  if (!value || /^none$/i.test(value)) return null;
  const clock = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (clock) {
    const day = stockholmDay(start);
    if (!day) return `${clock[1]}:${clock[2]}`;
    return stockholmWallTime({
      year: day.y,
      month: day.m,
      day: day.d,
      hour: Number(clock[1]),
      minute: Number(clock[2]),
    });
  }
  const both = value.match(/^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/);
  if (both?.[1] && validCalendarDay(both[1])) {
    const [year, month, day] = both[1].split('-').map(Number);
    return stockholmWallTime({
      year: year!,
      month: month!,
      day: day!,
      hour: Number(both[2]),
      minute: Number(both[3]),
    });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && validCalendarDay(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(new Date(value).getTime())) return value;
  return null;
}

function validCalendarDay(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(year!, month! - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month! - 1 && utc.getUTCDate() === day
  );
}

function clockOf(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const bare = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (bare) return `${bare[1]}:${bare[2]}`;
  const wall = raw.match(/T([01]\d|2[0-3]):([0-5]\d)/);
  return wall ? `${wall[1]}:${wall[2]}` : null;
}

function calendarDay(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw || clockOf(raw) === raw) return null;
  const day = stockholmDay(raw);
  if (!day) return null;
  const key = `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
  return validCalendarDay(key) ? key : null;
}

function withClock(day: string, clock: string | null): string {
  if (!clock) return day;
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = clock.split(':').map(Number);
  return stockholmWallTime({
    year: year!,
    month: month!,
    day: date!,
    hour: hour!,
    minute: minute!,
  });
}

function stockholmDay(
  value: string | null | undefined,
): { y: number; m: number; d: number } | null {
  const raw = clean(value);
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (
    dateOnly &&
    !raw.includes('T') &&
    validCalendarDay(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`)
  ) {
    return { y: Number(dateOnly[1]), m: Number(dateOnly[2]), d: Number(dateOnly[3]) };
  }
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const [y, m, d] = parts.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

/** Lines the chat appends (`link: none`, `price: free`, a url, a price, or a date) fill that fact. */
export function applyTipAnswers(
  base: TipExtraction,
  transcript: string | null | undefined,
): TipExtraction {
  const next: TipExtraction = { ...base };
  for (const raw of (transcript ?? '').split('\n')) {
    const line = raw.trim();
    const url = line.match(/^link:\s*(\S+)$/i);
    if (/^link:\s*none$/i.test(line)) {
      next.link = null;
      next.linkDeclined = true;
      continue;
    }
    const bare = url?.[1] ? bareTipLink(url[1]) : null;
    if (bare) {
      next.link = bare;
      next.linkDeclined = false;
      continue;
    }
    if (/^price:\s*free$/i.test(line)) {
      next.priceAmount = 0;
      next.priceLabel = 'Gratis';
      continue;
    }
    const price = line.match(/^price:\s*(\d{1,6}(?:[.,]\d{1,2})?)$/i);
    const minor = price?.[1] ? kronorMinor(price[1]) : null;
    if (price?.[1] && minor != null) {
      next.priceAmount = minor;
      next.priceLabel = `${price[1].replace('.', ',')} kr`;
      continue;
    }
    if (/^image:\s*none$/i.test(line)) {
      next.imageDeclined = true;
      continue;
    }
    if (/^(?:end|endDate):\s*none$/i.test(line)) {
      next.endsAt = null;
      next.endTime = null;
      next.endDeclined = true;
      next.endTimeDeclined = true;
      continue;
    }
    if (/^startTime:\s*none$/i.test(line)) {
      next.startTime = null;
      next.startTimeDeclined = true;
      const day = calendarDay(next.startsAt);
      if (day) next.startsAt = day;
      continue;
    }
    if (/^endTime:\s*none$/i.test(line)) {
      next.endTime = null;
      next.endTimeDeclined = true;
      const day = calendarDay(next.endsAt);
      if (day) next.endsAt = day;
      continue;
    }
    const startClock = line.match(/^startTime:\s*(.+)$/i);
    if (startClock?.[1] && clockOf(startClock[1])) {
      const clock = clockOf(startClock[1])!;
      next.startTime = clock;
      next.startTimeDeclined = false;
      const day = calendarDay(next.startsAt);
      if (day) next.startsAt = withClock(day, clock);
      continue;
    }
    const endClock = line.match(/^endTime:\s*(.+)$/i);
    if (endClock?.[1] && clockOf(endClock[1])) {
      const clock = clockOf(endClock[1])!;
      next.endTime = clock;
      next.endTimeDeclined = false;
      next.endDeclined = false;
      const day = calendarDay(next.endsAt);
      if (day) next.endsAt = withClock(day, clock);
      continue;
    }
    const end = line.match(/^(?:end|endDate):\s*(.+)$/i);
    if (end?.[1]) {
      const value = tipEndValue(end[1], next.startsAt);
      if (value) {
        next.endsAt = value;
        next.endDeclined = false;
        const clock = clockOf(value);
        if (clock) {
          next.endTime = clock;
          next.endTimeDeclined = false;
        }
        continue;
      }
    }
    const date = line.match(/^(?:date|startDate):\s*(\d{4}-\d{2}-\d{2})$/);
    if (date?.[1] && calendarDay(date[1])) {
      const clock = next.startTimeDeclined ? null : clockOf(next.startTime);
      next.startsAt = withClock(date[1], clock);
    }
  }
  return next;
}

export function tipDetailProgress(extraction: TipExtraction): {
  done: number;
  total: number;
  missing: TipDetail[];
} {
  const missing = TIP_DETAILS.filter((detail) => !detailFilled(detail, extraction));
  return { done: TIP_DETAILS.length - missing.length, total: TIP_DETAILS.length, missing };
}

const TIP_IMAGE_QUESTION: Record<TipLocale, { reading: string; ask: string }> = {
  sv: {
    reading: 'Vi hämtar uppgifter från bilden.',
    ask: 'Vill du lägga till en bild?',
  },
  en: {
    reading: "We're getting details from the picture.",
    ask: 'Do you want to add a picture?',
  },
};

export type TipImageState = 'missing' | 'scanning' | 'ready' | 'declined';

const LINK_YES: Record<TipLocale, TipAskOption> = {
  sv: { label: 'Ja', reply: null },
  en: { label: 'Yes', reply: null },
};

const LINK_NO: Record<TipLocale, TipAskOption> = {
  sv: { label: 'Nej', reply: 'link: none' },
  en: { label: 'No', reply: 'link: none' },
};

/** A closed question needs yes and no. A question that asks for the address does not. */
function linkAsksExistence(question: string): boolean {
  const text = question.trim().toLowerCase();
  if (
    /vilken|vilket|vad är|what is|what's|which |address|adress|\burl\b|ange |skriv |paste|enter /.test(
      text,
    )
  ) {
    return false;
  }
  return /finns det|har evenemanget|har det en|is there|does it have|does the event have/.test(
    text,
  );
}

export function shownTipOptions(ask: TipFollowUp, locale: TipLocale): TipAskOption[] {
  const options = ask.options ?? [];
  if (ask.key !== 'link' || !linkAsksExistence(ask.question)) return options;
  const next = [...options];
  if (!next.some((option) => option.reply == null)) next.unshift(LINK_YES[locale]);
  if (!next.some((option) => option.reply === 'link: none')) next.push(LINK_NO[locale]);
  return next.slice(0, 4);
}

function withUnknownOption(
  detail: TipDetail,
  options: TipAskOption[],
  locale: TipLocale,
): TipAskOption[] {
  if (
    detail === 'endsAt' &&
    !options.some((option) => option.reply === 'endDate: none' || option.reply === 'end: none')
  ) {
    return [...options, END_UNKNOWN[locale]];
  }
  if (detail === 'startTime' && !options.some((option) => option.reply === 'startTime: none')) {
    return [...options, START_TIME_UNKNOWN[locale]];
  }
  if (detail === 'endTime' && !options.some((option) => option.reply === 'endTime: none')) {
    return [...options, END_TIME_UNKNOWN[locale]];
  }
  return options;
}

/** The next bot line. Facts come first. A picture is the last step. */
export function tipFollowUpQuestion(input: {
  questions: TipFollowUp[];
  missing: TipDetail[];
  locale: TipLocale;
  image?: TipImageState;
}): TipFollowUp | null {
  const image = input.image ?? 'ready';
  if (image === 'scanning') return null;
  if (input.missing.length > 0) {
    const detail = input.missing[0]!;
    const asked = input.questions.find(
      (question) => detailForAsk(question.key) === detail && question.question.trim().length > 0,
    );
    const options = asked?.options ?? [];
    const ask: TipFollowUp = {
      key: DETAIL_KEY[detail],
      question: (asked?.question ?? TIP_DETAIL_QUESTION[detail][input.locale]).trim().slice(0, 240),
      options: withUnknownOption(detail, options, input.locale),
    };
    return { ...ask, options: shownTipOptions(ask, input.locale) };
  }
  if (image === 'missing') {
    return { key: 'image', question: TIP_IMAGE_QUESTION[input.locale].ask, options: [] };
  }
  return null;
}

/** The bubble shown over a picture while it is being read. */
export function tipImageReading(locale: TipLocale): TipFollowUp {
  return { key: 'image', question: TIP_IMAGE_QUESTION[locale].reading, options: [] };
}

/** Assistant rows store the key with the question so the chat can rebuild the control. */
export function tipAskBody(ask: TipFollowUp): string {
  return JSON.stringify({ key: ask.key, question: ask.question, options: ask.options ?? [] });
}

export function tipAskFromBody(body: string): TipFollowUp | null {
  try {
    const value = JSON.parse(body) as { key?: unknown; question?: unknown; options?: unknown };
    if (!isTipAskKey(value.key) || typeof value.question !== 'string' || !value.question.trim()) {
      return null;
    }
    return {
      key: value.key,
      question: value.question,
      options: tipAskOptions(value.key, value.options),
    };
  } catch {
    return null;
  }
}

/** Each reply is appended so the next read sees the whole conversation. */
export function tipTranscript(previous: string | null | undefined, next: string): string {
  const prior = clean(previous) ?? '';
  const added = next.trim();
  const joined = prior ? `${prior}\n${added}` : added;
  return joined.slice(0, 8000);
}

export function tipCard(extraction: TipExtraction): TipCard {
  return {
    title: clean(extraction.title),
    startsAt: clean(extraction.startsAt),
    place: clean(extraction.place),
    priceLabel: clean(extraction.priceLabel),
    link: bareTipLink(extraction.link),
    endsAt: extraction.endDeclined ? null : clean(extraction.endsAt),
    summary: clean(extraction.summary)?.slice(0, 500) ?? null,
    tags: extraction.tags ?? [],
  };
}

export function hasUsableTitle(extraction: TipExtraction): boolean {
  return (clean(extraction.title)?.length ?? 0) >= 2;
}

/** The confirm step still asks when the chat left out a description. */
export function needsTipFollowUp(input: {
  path: TipPath;
  extraction: TipExtraction;
  hasImage: boolean;
}): boolean {
  void input.path;
  void input.hasImage;
  return !clean(input.extraction.description);
}

export function tipPhase(input: {
  path: TipPath;
  status: TipStatus;
  scanStatus: string | null;
  imageStatus: 'none' | 'scanning' | 'ready' | 'failed';
  hasExtraction: boolean;
  /** Text chat stays open until every required detail is filled. */
  detailsComplete?: boolean;
}): TipPhase {
  if (input.status === 'failed' || input.scanStatus === 'failed') return 'failed';
  if (input.status === 'scanned' && input.scanStatus === 'published') return 'published';
  if (input.status === 'scanned') return 'review';
  if (input.status === 'submitted') return 'receipt';
  if (input.status === 'needs_input') return 'follow_up';
  if (input.status === 'collecting') {
    return input.detailsComplete ? 'confirm' : 'collecting';
  }
  return 'collecting';
}

export function fallbackTipTitle(input: {
  title?: string | null;
  text?: string | null;
  locale: TipLocale;
}): string {
  const title = clean(input.title);
  if (title && title.length >= 2) return title.slice(0, 200);
  const line = clean(input.text)?.split('\n')[0];
  if (line && line.length >= 2) return line.slice(0, 200);
  return input.locale === 'en' ? 'Tipped event' : 'Tipsat evenemang';
}

export function tipOpenAllowed(
  openCount: number,
): { ok: true } | { ok: false; reason: 'open_limit' } {
  if (openCount >= TIP_DAILY_LIMIT) return { ok: false, reason: 'open_limit' };
  return { ok: true };
}

export function tipSubmissionAllowed(
  submittedToday: number,
): { ok: true } | { ok: false; reason: 'daily_limit' } {
  if (submittedToday >= TIP_DAILY_LIMIT) return { ok: false, reason: 'daily_limit' };
  return { ok: true };
}

export function tipImageAllowed(input: {
  contentType: string;
  byteLength: number;
  existingCount: number;
}): { ok: true } | { ok: false; reason: 'unsupported_type' | 'too_large' | 'too_many' } {
  if (!TIP_IMAGE_TYPES.includes(input.contentType as TipImageType)) {
    return { ok: false, reason: 'unsupported_type' };
  }
  if (input.byteLength > TIP_IMAGE_MAX_BYTES || input.byteLength < 1) {
    return { ok: false, reason: 'too_large' };
  }
  if (input.existingCount >= TIP_IMAGE_MAX_COUNT) return { ok: false, reason: 'too_many' };
  return { ok: true };
}

export function visionIsStale(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() >= TIP_VISION_STALE_MS;
}

/** ISO-8601 only. A display string stays on the card and is not a timestamp. */
export function tipInstant(value: string | null | undefined): Date | null {
  const raw = clean(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function tipOrganizerKeys(input: {
  tipId: string;
  organizerName?: string | null;
  link?: string | null;
}): string[] {
  return organizerKeys({
    names: [input.organizerName],
    infoUrls: [input.link],
    fallback: `tip:${input.tipId}`,
  });
}

export function tipScanNotification(input: {
  locale: TipLocale;
  status: 'published' | 'in_review' | 'failed' | 'needs_input';
  title: string;
  place: string | null;
}): { title: string; body: string } {
  const place = clean(input.place);
  const name = input.title.trim() || (input.locale === 'en' ? 'the event' : 'eventet');
  if (input.locale === 'en') {
    if (input.status === 'published') {
      return {
        title: 'Your event is ready!',
        body: place
          ? `We added ${name} at ${place}. Thanks for the tip!`
          : `We added ${name}. Thanks for the tip!`,
      };
    }
    if (input.status === 'needs_input') {
      return {
        title: 'We need a bit more',
        body: 'The photo did not include enough to add the event. You can fill in the rest.',
      };
    }
    if (input.status === 'failed') {
      return {
        title: 'We could not check the tip',
        body: 'Something went wrong while reading the event. You can see the status in your tips.',
      };
    }
    return {
      title: 'We are checking your tip',
      body: `${name} is in review. We will add it after a check.`,
    };
  }
  if (input.status === 'published') {
    return {
      title: 'Ditt event är klart!',
      body: place
        ? `Vi har lagt till ${name} i ${place}. Tack för ditt tips!`
        : `Vi har lagt till ${name}. Tack för ditt tips!`,
    };
  }
  if (input.status === 'needs_input') {
    return {
      title: 'Vi behöver lite mer',
      body: 'Bilden räckte inte för att lägga till eventet. Du kan fylla i resten.',
    };
  }
  if (input.status === 'failed') {
    return {
      title: 'Vi kunde inte granska tipset',
      body: 'Något gick fel när vi läste eventet. Du kan se status under dina tips.',
    };
  }
  return {
    title: 'Vi granskar ditt tips',
    body: `${name} väntar på en kontroll. Vi lägger till det efter det.`,
  };
}

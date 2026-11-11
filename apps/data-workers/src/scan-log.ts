import type { PublisherStatus, SourceTrust } from '@local-events/domain';
import type { ScanOutcome } from './prompt-runners/types';

type ReadyScan = Extract<ScanOutcome, { ok: true }>;

/** One readable record of a finished scan. The admin scan tab shows this text. */
export function formatScanLog(input: {
  title: string;
  source: string;
  trust: SourceTrust;
  placeLine?: string;
  placeCity?: string;
  storedPoint?: { lat: number; lng: number };
  outcome: ReadyScan;
  publisher: { id: string; status: PublisherStatus; isTemporary: boolean; name: string };
  status: 'published' | 'in_review';
  lookups: string[];
  venue: string;
  point?: { lat: number; lng: number };
  addressKept: string;
  occasionGroup: string;
}): string {
  const publisher = input.publisher.isTemporary
    ? `Temporary publisher "${input.publisher.name}" (${input.publisher.id}), status ${input.publisher.status}.`
    : `Publisher ${input.publisher.id}, status ${input.publisher.status}.`;
  const duplicate = input.outcome.duplicate
    ? `Possible duplicate of "${input.outcome.duplicate.title}" (${input.outcome.duplicate.eventId}), matched on ${input.outcome.duplicate.matchedOn}.`
    : 'No duplicate.';
  const tags =
    input.outcome.tags.length > 0
      ? input.outcome.tags.map((tag) => tag.name || tag.externalId).join(', ')
      : 'none';
  const venues = (input.outcome.possibleVenueNames ?? [])
    .map((venue) => `${venue.name} (${venue.rank})`)
    .join(', ');
  const address = input.outcome.address;
  const addressLine = address
    ? [address.address, address.zipCode, address.city].filter(Boolean).join(', ')
    : 'none';
  const showings = (input.outcome.possibleOccasions ?? [])
    .map((item) => {
      const place = 'venueName' in item && item.venueName ? `, ${clip(item.venueName, 80)}` : '';
      return `${item.startsAt}–${item.endsAt}${place}`;
    })
    .join('; ');
  const tools = toolLookupLines(input.outcome.llmOutput);
  const lookups = [
    ...(tools.length > 0 ? ['Model tools:', ...tools] : ['The model called no tools.']),
    ...input.lookups,
  ];
  return [
    'Found',
    `Title: ${input.title}`,
    `Source: ${input.source}, trust ${input.trust}.`,
    `Place line: ${input.placeLine || 'none'}.`,
    `City: ${input.placeCity || 'none'}.`,
    `Stored point: ${input.storedPoint ? pointText(input.storedPoint) : 'none'}.`,
    '',
    'Model',
    `Content: ${input.outcome.contentVerdict}.`,
    publisher,
    duplicate,
    `Tags: ${tags}.`,
    `Address: ${addressLine}${address?.rank != null ? `, rank ${address.rank}` : ''}.`,
    input.addressKept,
    `Venue names: ${venues || 'none'}.`,
    `Showings: ${showings || 'none'}.`,
    input.outcome.summary ? `Summary: ${clip(input.outcome.summary, 240)}` : 'Summary: none.',
    input.occasionGroup,
    '',
    'Lookups',
    ...(lookups.length > 0 ? lookups : ['No lookups.']),
    '',
    'Decision',
    statusLine(input),
    input.venue,
    `Point written: ${input.point ? pointText(input.point) : 'none'}.`,
  ].join('\n');
}

export function attachScanLog(output: object | null, log: string): object {
  if (output && !Array.isArray(output)) return { ...output, scanLog: log };
  return { scanLog: log };
}

/** Tool names the model called, with short arguments. Page text and long values are left out. */
export function toolLookupLines(output: unknown): string[] {
  const stored = storedToolLookups(output);
  if (stored.length > 0) return stored;
  const lines: string[] = [];
  const seen = new Set<string>();
  walkTools(output, lines, seen, 0);
  return lines;
}

function storedToolLookups(output: unknown): string[] {
  if (!output || typeof output !== 'object' || !('toolLookups' in output)) return [];
  const value = output.toolLookups;
  if (!Array.isArray(value)) return [];
  return value.flatMap((line) => (typeof line === 'string' && line.trim() ? [line.trim()] : []));
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function statusLine(input: {
  status: 'published' | 'in_review';
  outcome: ReadyScan;
  trust: SourceTrust;
  publisher: { status: PublisherStatus; isTemporary: boolean };
}): string {
  if (input.status === 'published') {
    return 'Published. The scan approved the event, the publisher is published, and the source publishes on its own.';
  }
  const reasons: string[] = [];
  if (input.outcome.duplicate) reasons.push('it may be a duplicate');
  if (input.trust !== 'auto_publish') reasons.push(`the source trust is ${input.trust}`);
  if (input.publisher.isTemporary) reasons.push('the publisher is temporary');
  else if (input.publisher.status !== 'published') {
    reasons.push(`the publisher status is ${input.publisher.status}`);
  }
  if (!input.outcome.approved) reasons.push('the scan did not approve the content');
  return `In review${reasons.length > 0 ? ` because ${reasons.join(', ')}` : ''}.`;
}

function pointText(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

function walkTools(value: unknown, lines: string[], seen: Set<string>, depth: number) {
  if (depth > 8 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walkTools(item, lines, seen, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.tool_calls)) {
    for (const call of record.tool_calls) noteToolCall(call, lines, seen);
  }
  if (record.type === 'tool_use') noteToolCall(record, lines, seen);
  for (const [key, child] of Object.entries(record)) {
    if (key === 'scanLog' || !child || typeof child !== 'object') continue;
    walkTools(child, lines, seen, depth + 1);
  }
}

function noteToolCall(call: unknown, lines: string[], seen: Set<string>) {
  if (!call || typeof call !== 'object') return;
  const record = call as Record<string, unknown>;
  const fn =
    record.function && typeof record.function === 'object'
      ? (record.function as Record<string, unknown>)
      : record;
  const name = typeof fn.name === 'string' ? fn.name.trim() : '';
  if (!name) return;
  const args = fn.arguments ?? fn.input;
  const summary = argSummary(args);
  const line = summary ? `${name} ${summary}` : name;
  if (seen.has(line)) return;
  seen.add(line);
  lines.push(line);
}

function argSummary(raw: unknown): string {
  const record = readArgs(raw);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      const text = value.replace(/\s+/g, ' ').trim();
      if (!text || text.length > 80) continue;
      parts.push(`${key}=${text}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.join(', ');
}

function readArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

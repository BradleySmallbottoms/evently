export type ScanView = {
  /** The model's final scan object, without the reasoning text. */
  finalObject: Record<string, unknown> | null;
  reasoning: string | null;
  full: string;
};

/** Splits a stored model response into the scan object, its reasoning, and the raw JSON. */
export function readScanView(output: unknown): ScanView | null {
  const full = formatJson(output);
  if (!full) return null;
  const root = asRecord(typeof output === 'string' ? parseJson(output) : output);
  const message = assistantMessage(root);
  const content = message ? messageText(message.content) : null;
  const parsed = content ? parseObject(content) : null;
  const finalRecord = parsed ?? (root && isScanRecord(root) ? root : null);
  const reasoning = reasoningText(finalRecord, message);
  const finalObject = finalRecord ? withoutReasoning(finalRecord) : null;
  return {
    finalObject: finalObject && Object.keys(finalObject).length > 0 ? finalObject : null,
    reasoning,
    full,
  };
}

function formatJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = parseJson(trimmed);
      return parsed == null ? value : JSON.stringify(parsed, null, 2);
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

/** Later models name the explanation `decision_explanation`; earlier ones use `reasoning_content`. */
const REASONING_FIELDS = ['decision_explanation', 'reasoning_content'] as const;

function reasoningText(
  finalRecord: Record<string, unknown> | null,
  message: Record<string, unknown> | null,
): string | null {
  for (const source of [finalRecord, message]) {
    if (!source) continue;
    for (const field of REASONING_FIELDS) {
      const text = textField(source[field]);
      if (text) return text;
    }
  }
  return null;
}

function withoutReasoning(record: Record<string, unknown>): Record<string, unknown> {
  if (!REASONING_FIELDS.some((field) => field in record)) return record;
  const rest = { ...record };
  for (const field of REASONING_FIELDS) delete rest[field];
  return rest;
}

function textField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function assistantMessage(root: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!root) return null;
  const choices = root.choices;
  if (Array.isArray(choices)) {
    const choice = asRecord(choices[0]);
    const message = asRecord(choice?.message);
    if (message) return message;
  }
  if (Array.isArray(root.content)) {
    const message = asRecord({
      type: 'message',
      content: root.content.map((part) => part.text).join('\n'),
    });
    if (message) return message;
  }
  const message = asRecord(root.message);
  if (message) return message;
  return null;
}

function messageText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    const record = asRecord(part);
    if (record && typeof record.text === 'string') parts.push(record.text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function parseObject(content: string): Record<string, unknown> | null {
  const trimmed = stripFence(content.trim());
  const direct = asRecord(parseJson(trimmed));
  if (direct) return direct;
  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  const end = matchingBrace(trimmed, start);
  if (end < 0) return null;
  return asRecord(parseJson(trimmed.slice(start, end + 1)));
}

function stripFence(content: string): string {
  const match = content.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return match?.[1]?.trim() || content;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isScanRecord(record: Record<string, unknown>): boolean {
  return (
    'contentVerdict' in record ||
    'possibleTags' in record ||
    'possiblePublishers' in record ||
    'possibleDuplicates' in record ||
    'summary' in record
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function matchingBrace(content: string, start: number): number {
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') quote = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}


import { Id } from '@local-events/contracts';
import { type NearbyWindow } from '@local-events/geo';
import {
  ollamaBaseUrl,
  ollamaDisabled,
  ollamaModel,
  parseTagChoices,
  type LLMOutput,
  type LLMScanResult,
  type TagChoice,
  type TagMatchInput,
} from '@local-events/ingest';
import { LOCAL_ORGANIZER_SLUGS } from '../sources';
import { NEARBY_DAYS_AFTER, NEARBY_DAYS_BEFORE, publisherNameMatcher, type IngestStore, type NearbyEventHit, type NearbyPublisherHit, type PublisherCandidate, type PublisherRecord } from '../store';
import type { ChosenPublisher, PossibleDuplicateMatch, PromptRunner, ScanInput, ScanOutcome } from './types';

/** How long one Ollama request may run before the scan gives up on it. */
const CHAT_TIMEOUT_MS = 90_000;
/** Tool rounds for one event. The last round still has to be a text answer, or the scan is unavailable. */
const MAX_TOOL_ROUNDS = 8;
const DESCRIPTION_LIMIT = 1_200;
/**
 * How many tool calls from one model reply are run. The scan prompt asks for all
 * five tools in one turn. Claude rejects the next request when a `tool_use` has
 * no `tool_result`, so a call past this cap still gets an error result.
 */
const MAX_TOOL_CALLS_PER_ROUND = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OllamaWithToolsRunnerOptions {
  /**
   * Chat settings. With no `chatUrl`, the runner calls local Ollama at `/api/chat`.
   * `chatUrl` is the full endpoint. `chatAuth` is the header value (`Bearer …` is added
   * for `Authorization` when the value has no scheme). `chatAuthHeader` defaults to
   * `Authorization`, or `x-api-key` for Anthropic. The same names exist as `CHAT_URL`,
   * `CHAT_MODEL`, `CHAT_AUTH`, and `CHAT_AUTH_HEADER`. `CHAT_PROVIDER=chatgpt` uses
   * `OPENAI_API_KEY` and `https://api.openai.com/v1/chat/completions`. `CHAT_PROVIDER=claude`
   * uses `ANTHROPIC_API_KEY` and `https://api.anthropic.com/v1/messages`.
   */
  config?: Record<string, unknown>;
  /** Tests pass this so a scan does not call a running chat API. */
  fetch?: typeof fetch;
}

type ChatProtocol = 'ollama' | 'openai' | 'anthropic';

/** One configured chat endpoint. `headers` already includes auth and never includes the URL userinfo. */
interface ChatEndpoint {
  url: URL;
  model: string;
  protocol: ChatProtocol;
  headers: Record<string, string>;
}

interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Assistant turn in the shape that provider expects to see again, plus the calls to run. */
interface AssistantTurn {
  wire: Record<string, unknown>;
  text: string;
  calls: ParsedToolCall[];
}

/** Everything a tool needs besides the arguments the model sent. */
interface LookupContext {
  store: IngestStore;
  event: ScanInput;
  catalog: TagChoice[];
}

type ToolResult =
  | { error: string }
  | { events: NearbyEventHit[] }
  | { publishers: NearbyPublisherHit[] }
  | { possiblePublishers: PublisherCandidate[] }
  | { tags: { id: string; name: string }[] };

/**
 * Tools offered on every chat call. The provider does not run them; the runner does.
 * OpenAI and Ollama share this shape. Anthropic is mapped in {@link anthropicToolDefinitions}.
 * Radius, time window, and row cap are described here and enforced in the lookups.
 */
function chatToolDefinitions(): object[] {
  const noArguments = { type: 'object', properties: {} };
  return [
    {
      type: 'function',
      function: {
        name: 'getNearbyEvents',
        description:
          'Events within 500 m of the event being scanned. Their start is from 1 day before that event through 1 day after. Cancelled and ended events are left out. Takes no arguments; the event point is used.',
        parameters: noArguments,
      },
    },
    {
      type: 'function',
      function: {
        name: 'getNearbyPublishers',
        description:
          'Publishers that have an event within 500 m of the event being scanned, in that same time window. Takes no arguments; the event point is used.',
        parameters: noArguments,
      },
    },
    {
      type: 'function',
      function: {
        name: 'getPublishersByName',
        description:
          'Publishers whose name matches. * matches any text and ? matches one character. Only publishers with an event within 50 km of the event being scanned are returned.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Publisher name. Use * for any text and ? for one character, for example Hälsing*.',
            },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getPossiblePublishers',
        description: 'Publishers that match the organizer keys of the event being scanned. Distance in meters to the closest event from the scanned event is included. Takes no arguments.',
        parameters: noArguments,
      },
    },
    {
      type: 'function',
      function: {
        name: 'getAvailableTags',
        description: 'The tag catalog. Call this before choosing tags. Only ids from this list may be used. Takes no arguments.',
        parameters: noArguments,
      },
    },
  ];
}

/**
 * Scans a batch with tool calling. Same result shape as the plain Ollama runner:
 * the model may look up events, publishers, and tags, and code still picks the
 * publisher and the duplicate.
 */
export function createOllamaWithToolsPromptRunner(
  store: IngestStore,
  options: OllamaWithToolsRunnerOptions = {},
): PromptRunner {
  const config = options.config ?? {};
  const fetchImpl = options.fetch ?? fetch;
  return {
    id: 'ollama-with-tools',
    /**
     * One event at a time. The tag catalog is loaded once. A repeated title,
     * place, and start reuses the first model answer instead of calling again.
     */
    async scan(batch) {
      const catalog = (await store.listTags()).map((tag) => ({
        externalId: tag.externalId,
        name: tag.name,
      }));
      const outcomes: ScanOutcome[] = [];
      for (const event of batch) {
        outcomes.push(await scanOneEvent(event, { store, event, catalog }, config, fetchImpl));
      }
      return outcomes;
    },
  };
}

/**
 * Asks the model, then resolves the publisher and duplicate in code.
 * No organizer key means there is nothing to attach, so the model is not called.
 * A failed model call leaves the row for a later scan.
 */
async function scanOneEvent(
  event: ScanInput,
  context: LookupContext,
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<ScanOutcome> {
  if (event.organizer.keys.length === 0) {
    return { ok: false, eventId: event.eventId, reason: 'unavailable' };
  }

  const content = (await askModelWithLookups(buildScanPrompt(event), context, config, fetchImpl)) ?? 'unavailable';
  console.log('content', JSON.stringify(content, null, 2));
  throw new Error('test');

  if (content === 'unavailable') {
    return { ok: false, eventId: event.eventId, reason: 'unavailable' };
  }

  const tags =
    event.existingTags.length > 0 ? event.existingTags : parseTagChoices(content, context.catalog);
  const publisher = await bestPublisher(content, context);
  const duplicate = await bestDuplicate(content, context);
  const occasionMatches = content.possibleDuplicates.flatMap((item) =>
    typeof item.occasionRank === 'number' ? [{ eventId: item.eventId, occasionRank: item.occasionRank }] : [],
  );

  return {
    ok: true,
    eventId: event.eventId,
    publisher: publisher ?? {
      kind: 'temporary',
      name: event.organizer.name?.trim() || event.organizer.keys[0] || event.title,
      organizerKeys: event.organizer.keys,
    },
    duplicate,
    occasionMatches,
    approved: true,
    tags,
    contentVerdict: content.contentVerdict,
    summary: content.summary,
    language: content.language,
    llmOutput: content.output,
  };
}

async function bestPublisher(content: LLMScanResult & LLMOutput, context: LookupContext): Promise<ChosenPublisher | null> {
  if (content.possiblePublishers.length === 0) return null;
  // by rank
  const bestMatch = content.possiblePublishers.sort((a, b) => a.rank - b.rank)[0];
  if (!bestMatch) return null;
  if (!Id.safeParse(bestMatch.publisherId).success) return null;
  const publisher = await context.store.getPublisher(bestMatch.publisherId);
  if (!publisher) return null;
  return {
    kind: 'existing',
    publisherId: publisher.id,
    isTemporary: publisher.isTemporary,
    verified: publisher.verified,
    importNotificationPlan: publisher.importNotificationPlan,
  }
}

async function bestDuplicate(content: LLMScanResult & LLMOutput, context: LookupContext): Promise<PossibleDuplicateMatch | null> {
  if (content.possibleDuplicates.length === 0) return null;
  // by rank
  const bestMatch = content.possibleDuplicates.sort((a, b) => a.rank - b.rank)[0];
  if (!bestMatch) return null;
  const event = await context.store.getEvent(bestMatch.eventId);
  if (!event) return null;
  return {
    eventId: event.eventId,
    title: event.title,
    startsAt: event.startsAt,
    refId: event.refId,
    workerId: event.workerId,
    matchedOn: 'llm',
  };
}

/**
 * Tells the model which tools exist and which JSON object to return when it is done.
 * Nearby tools take no coordinates; they use this event's point. The tag catalog is
 * not inlined; the model calls getAvailableTags for that.
 */
function buildScanPrompt(event: ScanInput): string {
  const description = event.description?.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_LIMIT);
  const place = event.location ? `lat ${event.location.lat}, lng ${event.location.lng}` : 'none';
  const publisherName = event.organizer.name?.trim() || '';
  const namePattern = publisherName ? `${publisherName.split(/\s+/)[0]}*` : '';
  return [
    'You scan one imported event for spam, language, tags, a short summary, the publisher, and a duplicate.',
    'Call one tool, wait for its result, then decide the next step. Do not return JSON in the same turn as a tool call.',
    'Never invent a publisher id, an event id, or a tag id. Every id in the JSON must come from a tool result.',
    '1. Call getAvailableTags(). This call is required and can never be skipped. Tags may only use ids from that list. Score each tag from 0 to 100 and include only scores over 90. Pick at most 2.',
    '2. Call getPossiblePublishers() before you match a publisher. Each returned publisher has a name and one or more organizer keys and dinstance in meter to the closest event from this event.',
    'Use the possible publishers name to rate how plausible it that this publisher has events like this event.',
    'Consider distanceMeters when deciding if a publisher is a reasonable match, events from the same publisher should be close to each other, less than 250 meters is a good match.',
    'If unsure try matching at least one organizer key to the scanned event',
    'Do not include keys like "domain.com" in the publisher match, only include keys like full website urls, names and addresses."',
    namePattern
      ? `3. If that list has no reasonable match, call getPublishersByName with name "${namePattern}". * matches any text and ? matches one character.`
      : '',
      //'3. If that list has no reasonable match, call getPublishersByName with the publisher name below and * after its first word.',
    '4. If the name list also has no reasonable match, call getNearbyPublishers().',
    '5. If the nearby list also has no reasonable match, possiblePublishers is []. That is allowed. A made-up publisher is not.',
    'Stop the publisher search at the first list that has a reasonable match. Include a publisher only when its rank is over 90. A empty list is allowed.',
    '6. Call getNearbyEvents() before you decide a duplicate. This call is required. Compare the scanned event with each event in the result.',
    'Rank the match from 0 to 100 and return only a duplicate if the rank is over 90.',
    'For every possible duplicate, rank how likely it is another occasion of the same event from 0 to 100. Another occasion is when the title, location, and description are similar but dates are different.',
    'Use the title, location, and description for the content verdict: "spam", "harmful", or "safe".',
    'Write a short and brief summary in the language of the event. Do not include the city name. A venue is fine when it matters.',
    'When you are finished, return only JSON:',
    '{possiblePublishers: [{publisherId: "<publisherId>", rank: <rank>}], possibleDuplicates: {eventId: "<eventId>", rank: <rank>, occasionRank: <occasionRank>}[], contentVerdict: "spam" | "harmful" | "safe", summary: "<summary>", language: "sv|en|etc", possibleTags: [{"id":"<id>","score":<score>}]}',
    'Event:',
    `Title: ${event.title}`,
    `Starts: ${event.startsAt}`,
    `Ends: ${event.endsAt}`,
    `Publisher name: ${event.organizer.name}`,
    'Publisher keys:',
    ...event.organizer.keys.map((key) => `- ${key}`),
    `Point: ${place}`,
    ...(event.venue ? [`Location: ${event.venue}`] : []),
    ...(description ? [`Description: ${description}`] : []),
  ].join('\n');
}

/**
 * Posts the prompt, runs any tool calls, and posts again until the model returns
 * text or the round cap is hit. `format: json` is left off so tool calls are not
 * forced into a text body. The final text is parsed as the scan JSON.
 */
async function askModelWithLookups(
  prompt: string,
  context: LookupContext,
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<LLMScanResult & LLMOutput | null> {
  const endpoint = resolveChatEndpoint(config);
  if (!endpoint) return null;
  if (endpoint.protocol === 'ollama' && ollamaDisabled()) return null;
  const messages: Record<string, unknown>[] = [{ role: 'user', content: prompt }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const payload = await postChat(endpoint, messages, round, fetchImpl);
    if (!payload) return null;
    const turn = readAssistantTurn(endpoint.protocol, payload);
    const calls = turn?.calls.slice(0, MAX_TOOL_CALLS_PER_ROUND) ?? [];
    if (!turn || calls.length === 0) {
      if (!turn || turn.text.length === 0) return null;
      return { ...parseScanJson(turn.text), output: payload };
    }
    const results: ToolResult[] = [];
    for (const call of calls) results.push(await executeToolCall(call, context));
    appendToolResults(endpoint.protocol, messages, turn.wire, calls, results);
  }
  return null;
}

/** Built-in ChatGPT and Claude endpoints. A custom `chatUrl` still overrides the URL. */
const CHAT_PROVIDERS = {
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4.1-mini',
    authConfig: 'openaiApiKey',
    authEnv: 'OPENAI_API_KEY',
    modelConfig: 'openaiModel',
    modelEnv: 'OPENAI_MODEL',
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-5-5',
    authConfig: 'anthropicApiKey',
    authEnv: 'ANTHROPIC_API_KEY',
    modelConfig: 'anthropicModel',
    modelEnv: 'ANTHROPIC_MODEL',
  },
} as const;

type NamedChatProvider = keyof typeof CHAT_PROVIDERS;

/**
 * Reads the chat settings from config, then the environment. `CHAT_PROVIDER=chatgpt`
 * uses OpenAI's chat completions URL and `OPENAI_API_KEY`. `CHAT_PROVIDER=claude` uses
 * Anthropic's messages URL and `ANTHROPIC_API_KEY`. No provider and no URL means local
 * Ollama `/api/chat`. `http` is only allowed on loopback. A URL with a username or
 * password is rejected so the secret stays in the auth header. A named provider with
 * no key does not fall back to Ollama.
 */
function resolveChatEndpoint(config: Record<string, unknown>): ChatEndpoint | null {
  const named = namedChatProvider(config);
  if (named === 'invalid') return null;
  const provider = named === 'ollama' || named === 'unset' ? null : CHAT_PROVIDERS[named];
  const rawUrl = configString(config, 'chatUrl', 'CHAT_URL') || provider?.url || '';
  let url: URL;
  try {
    url = rawUrl ? new URL(rawUrl) : new URL('/api/chat', ollamaBaseUrl(config));
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const loopback = isLoopback(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;

  const protocol = chatProtocol(url);
  const configuredModel = configString(config, 'chatModel', 'CHAT_MODEL');
  const providerModel = provider ? configString(config, provider.modelConfig, provider.modelEnv) : '';
  let model = configuredModel || providerModel || provider?.defaultModel || '';
  if (!model) {
    try {
      model = ollamaModel(config);
    } catch {
      return null;
    }
  }
  if (!/^[\w./:-]{1,120}$/.test(model)) return null;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const providerAuth = provider ? configString(config, provider.authConfig, provider.authEnv) : '';
  const auth = configString(config, 'chatAuth', 'CHAT_AUTH') || providerAuth;
  if (provider && !auth) return null;
  const headerName =
    configString(config, 'chatAuthHeader', 'CHAT_AUTH_HEADER') ||
    (protocol === 'anthropic' ? 'x-api-key' : 'Authorization');
  if (auth) headers[headerName] = authorizationValue(headerName, auth);
  if (protocol === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  return { url, model, protocol, headers };
}

/**
 * `chatgpt` and `openai` share one endpoint. `claude` and `anthropic` share the other.
 * `ollama` keeps the local server. An empty value means no named provider. Anything else
 * is invalid, so the scan does not guess.
 */
function namedChatProvider(config: Record<string, unknown>): NamedChatProvider | 'ollama' | 'unset' | 'invalid' {
  const raw = configString(config, 'chatProvider', 'CHAT_PROVIDER').toLowerCase();
  if (!raw) return 'unset';
  if (raw === 'openai' || raw === 'chatgpt') return 'openai';
  if (raw === 'anthropic' || raw === 'claude') return 'anthropic';
  if (raw === 'ollama') return 'ollama';
  return 'invalid';
}

/** Config string, otherwise the environment variable. Blank is empty. */
function configString(config: Record<string, unknown>, key: string, envName: string): string {
  const fromConfig = config[key];
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
  return process.env[envName]?.trim() ?? '';
}

/** True for the hosts the Ollama helper already treats as this machine. */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Which request body to send. Path wins over the host, so Ollama's OpenAI-compatible
 * `/v1/chat/completions` is spoken as OpenAI.
 */
function chatProtocol(url: URL): ChatProtocol {
  const path = url.pathname.replace(/\/$/, '');
  if (path.endsWith('/api/chat')) return 'ollama';
  if (url.hostname.toLowerCase() === 'api.anthropic.com' || path.endsWith('/messages')) return 'anthropic';
  return 'openai';
}

/** `Authorization` without a scheme becomes `Bearer`. Other headers are sent as given. */
function authorizationValue(headerName: string, auth: string): string {
  if (headerName.toLowerCase() !== 'authorization' || auth.includes(' ')) return auth;
  return `Bearer ${auth}`;
}

/** Anthropic tools use `input_schema` instead of the OpenAI `function.parameters` wrapper. */
function anthropicToolDefinitions(): object[] {
  const tools: object[] = [];
  for (const tool of chatToolDefinitions()) {
    if (!tool || typeof tool !== 'object' || !('function' in tool)) continue;
    const fn = tool.function;
    if (!fn || typeof fn !== 'object') continue;
    const name = 'name' in fn && typeof fn.name === 'string' ? fn.name : '';
    const description = 'description' in fn && typeof fn.description === 'string' ? fn.description : '';
    const parameters = 'parameters' in fn ? fn.parameters : { type: 'object', properties: {} };
    if (!name) continue;
    tools.push({ name, description, input_schema: parameters });
  }
  return tools;
}

/**
 * One non-streaming chat request. Ollama keeps its `/api/chat` body. OpenAI and ChatGPT
 * use chat completions. Claude uses the Messages API. Current Claude models reject
 * `temperature`, so that field is left off. A non-OK response or a timeout returns null.
 * The auth header is not written to the log.
 */
async function postChat(
  endpoint: ChatEndpoint,
  messages: Record<string, unknown>[],
  round: number,
  fetchImpl: typeof fetch,
): Promise<object | null> {
  const body =
    endpoint.protocol === 'ollama'
      ? {
          model: endpoint.model,
          thinks: round > 0,
          stream: false,
          options: { temperature: 0 },
          tools: chatToolDefinitions(),
          messages,
        }
      : endpoint.protocol === 'anthropic'
        ? {
            model: endpoint.model,
            max_tokens: 4096,
            tools: anthropicToolDefinitions(),
            messages,
          }
        : {
            model: endpoint.model,
            temperature: 0,
            stream: false,
            tools: chatToolDefinitions(),
            messages,
          };
  try {
    console.log('postChat', endpoint.protocol, JSON.stringify(messages, null, 2));
    const response = await fetchImpl(endpoint.url, {
      method: 'POST',
      redirect: 'error',
      headers: endpoint.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    const payload: unknown = await response.json();
    console.log('response', response.status, payload, response.headers);
    if (!response.ok) return null;
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes one provider response into text plus tool calls. OpenAI's message is
 * `choices[0].message`. Claude's is a `content` array of text and `tool_use` blocks.
 * Ollama's is the top-level `message`.
 */
function readAssistantTurn(protocol: ChatProtocol, payload: object): AssistantTurn | null {
  if (protocol === 'anthropic') return readAnthropicTurn(payload);
  const message = protocol === 'openai' ? openAiMessage(payload) : ollamaMessage(payload);
  if (!message) return null;
  const text = messageText(message.content);
  return { wire: message, text: text ?? '', calls: readToolCalls(message) };
}

/** The assistant message object Ollama returned, or null when the body has none. */
function ollamaMessage(payload: object): Record<string, unknown> | null {
  if (!('message' in payload)) return null;
  const message = payload.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  return message as Record<string, unknown>;
}

/** The first choice message from an OpenAI chat-completions response. */
function openAiMessage(payload: object): Record<string, unknown> | null {
  if (!('choices' in payload) || !Array.isArray(payload.choices)) return null;
  const choice = payload.choices[0];
  if (!choice || typeof choice !== 'object' || !('message' in choice)) return null;
  const message = choice.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  return message as Record<string, unknown>;
}

/**
 * Claude returns a list of blocks. Text is joined for the scan JSON. Each `tool_use`
 * block becomes a call. The original blocks are sent back as the assistant turn.
 */
function readAnthropicTurn(payload: object): AssistantTurn | null {
  if (!('content' in payload) || !Array.isArray(payload.content)) return null;
  const texts: string[] = [];
  const calls: ParsedToolCall[] = [];
  for (const block of payload.content) {
    if (!block || typeof block !== 'object') continue;
    if ('type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      texts.push(block.text);
    }
    if ('type' in block && block.type !== 'tool_use') continue;
    if (!('name' in block) || typeof block.name !== 'string' || !block.name.trim()) continue;
    const id = 'id' in block && typeof block.id === 'string' && block.id.trim() ? block.id.trim() : `toolu-${calls.length}`;
    const input = 'input' in block ? block.input : undefined;
    calls.push({ id, name: block.name.trim(), arguments: readToolArguments(input) });
  }
  if (texts.length === 0 && calls.length === 0) return null;
  return { wire: { role: 'assistant', content: payload.content }, text: texts.join('\n'), calls };
}

/**
 * Text from a message. A string is kept. OpenAI's `null` content means there is no text.
 * A list of parts keeps each `text` field. Anything else is no text.
 */
function messageText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') continue;
    parts.push(part.text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Appends the assistant turn and the tool results in that provider's shape.
 * Claude wants one user message of `tool_result` blocks. OpenAI wants `tool_call_id`.
 * Ollama wants `tool_name`.
 */
function appendToolResults(
  protocol: ChatProtocol,
  messages: Record<string, unknown>[],
  wire: Record<string, unknown>,
  calls: ParsedToolCall[],
  results: ToolResult[],
): void {
  messages.push(wire);
  if (protocol === 'anthropic') {
    messages.push({ role: 'user', content: anthropicToolResults(wire, calls, results) });
    return;
  }
  for (let index = 0; index < calls.length; index++) {
    const call = calls[index]!;
    const content = JSON.stringify(results[index] ?? { error: 'Lookup failed.' });
    messages.push(
      protocol === 'openai'
        ? { role: 'tool', tool_call_id: call.id, content }
        : { role: 'tool', tool_name: call.name, content },
    );
  }
}

/**
 * One `tool_result` per `tool_use` in the assistant turn, in that same order.
 * A call the runner did not execute still gets an error result. Claude returns
 * 400 when any id is missing.
 */
function anthropicToolResults(
  wire: Record<string, unknown>,
  calls: ParsedToolCall[],
  results: ToolResult[],
): object[] {
  const byId = new Map<string, ToolResult>();
  calls.forEach((call, index) => {
    byId.set(call.id, results[index] ?? { error: 'Lookup failed.' });
  });
  const content = Array.isArray(wire.content) ? wire.content : [];
  const blocks: object[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object' || !('type' in block) || block.type !== 'tool_use') continue;
    const id = 'id' in block && typeof block.id === 'string' ? block.id : '';
    if (!id) continue;
    const ran = byId.has(id);
    blocks.push({
      type: 'tool_result',
      tool_use_id: id,
      content: JSON.stringify(ran ? byId.get(id) : { error: 'Tool call was not run.' }),
      ...(ran ? {} : { is_error: true }),
    });
  }
  if (blocks.length > 0) return blocks;
  return calls.map((call, index) => ({
    type: 'tool_result',
    tool_use_id: call.id,
    content: JSON.stringify(results[index] ?? { error: 'Lookup failed.' }),
  }));
}

/**
 * Tool calls on an assistant message. Ollama and OpenAI put them on `tool_calls`
 * with `function.name` and `function.arguments`. Arguments may be an object or
 * a JSON string. A call without a name is ignored. A missing id is filled in so
 * the OpenAI follow-up still has a `tool_call_id`.
 */
function readToolCalls(message: Record<string, unknown> | null): ParsedToolCall[] {
  if (!message || !Array.isArray(message.tool_calls)) return [];
  const calls: ParsedToolCall[] = [];
  for (const call of message.tool_calls) {
    if (!call || typeof call !== 'object') continue;
    const fn =
      'function' in call && call.function && typeof call.function === 'object' ? call.function : call;
    if (!fn || typeof fn !== 'object' || !('name' in fn) || typeof fn.name !== 'string') continue;
    const name = fn.name.trim();
    if (!name) continue;
    const id = 'id' in call && typeof call.id === 'string' && call.id.trim() ? call.id.trim() : `call-${calls.length}`;
    const args = 'arguments' in fn ? fn.arguments : undefined;
    calls.push({ id, name, arguments: readToolArguments(args) });
  }
  return calls;
}

/** Tool arguments as an object. A JSON string is parsed. Anything else is empty. */
function readToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

/**
 * Runs one tool the model named. Unknown names and bad coordinates come back as
 * `{ error }` so the model can correct itself. A lookup failure is the same shape
 * and does not abort the rest of the scan.
 */
async function executeToolCall(call: ParsedToolCall, context: LookupContext): Promise<ToolResult> {
  try {
    console.log('Running call', call.name);
    if (call.name === 'getAvailableTags') return lookupAvailableTags(context.catalog);
    if (call.name === 'getNearbyEvents') return lookupNearbyEvents(context);
    if (call.name === 'getNearbyPublishers') return lookupNearbyPublishers(context);
    if (call.name === 'getPublishersByName') return lookupPublishersByName(call.arguments, context);
    if (call.name === 'getPossiblePublishers') return lookupPossiblePublishers(context);
    return { error: `Unknown tool ${call.name}.` };
  } catch {
    return { error: 'Lookup failed.' };
  }
}

/**
 * Tags loaded for this batch. The id field matches the `possibleTags` JSON the
 * model must return, so it can copy an id from this list.
 */
function lookupAvailableTags(catalog: TagChoice[]): ToolResult {
  return { tags: catalog.map((tag) => ({ id: tag.externalId, name: tag.name })) };
}

/** The event's own point. Nearby tools never take coordinates from the model. */
function eventPoint(context: LookupContext): { lat: number; lng: number } | { error: string } {
  if (!context.event.location) return { error: 'This event has no point.' };
  return context.event.location;
}

/**
 * The time window the model cannot pass: one day before the scanned start
 * through 60 days after. An unreadable start makes the window empty.
 */
function nearbyWindow(startsAt: string): NearbyWindow {
  const start = new Date(startsAt).getTime();
  if (!Number.isFinite(start)) return { from: new Date(0), to: new Date(0) };
  return {
    from: new Date(start - NEARBY_DAYS_BEFORE * DAY_MS),
    to: new Date(start + NEARBY_DAYS_AFTER * DAY_MS),
  };
}

/**
 * Nearby events around the event being scanned. The scanned event is left out.
 * The model does not pass a point.
 */
async function lookupNearbyEvents(context: LookupContext): Promise<ToolResult> {
  const point = eventPoint(context);
  if ('error' in point) return point;
  const window = nearbyWindow(context.event.startsAt);
  const events = await context.store.nearbyEvents(point, window, context.event.eventId);
  return { events };
}

/** Possible publisher candidates based on the event organizer keys and the event location. */
async function lookupPossiblePublishers(
  context: LookupContext,
): Promise<ToolResult> {
  const event = context.event;
  const localSlugs = [...new Set([event.source.slug, ...LOCAL_ORGANIZER_SLUGS])];
  const publishers = await context.store.listPublisherCandidates(event.source.id, event.organizer.keys, {
    ...(event.location ? { location: event.location } : {}),
    localSlugs,
  })
//).filter((publisher) => publisher.distanceMeters <= 500);
  const possiblePublishers = publishers.map((publisher) => ({
    publisherId: publisher.publisherId,
    sourceId: publisher.sourceId,
    key: publisher.key,
    verified: publisher.verified,
    createdAt: publisher.createdAt,
    distanceMeters: publisher.distanceMeters,
    isTemporary: publisher.isTemporary,
    organizerKeys: publisher.organizerKeys,
    publisherName: publisher.publisherName,
  }));
  return { possiblePublishers };
}

/**
 * Publishers with an event near the point, in the same window as nearby events.
 * Each publisher is returned once, from its closest event, capped at 20.
 */
async function lookupNearbyPublishers(context: LookupContext): Promise<ToolResult> {
  const point = eventPoint(context);
  if ('error' in point) return point;
  const window = nearbyWindow(context.event.startsAt);
  const publishers = await context.store.nearbyPublishers(point, window, context.event.eventId);
  return { publishers };
}

/**
 * Publishers whose name matches `*` and `?`, and that have an event within 50 km
 * of the event being scanned. A pattern with no letter or number is an error.
 */
async function lookupPublishersByName(
  args: Record<string, unknown>,
  context: LookupContext,
): Promise<ToolResult> {
  const point = eventPoint(context);
  if ('error' in point) return point;
  const name = typeof args.name === 'string' ? args.name : '';
  const matcher = publisherNameMatcher(name);
  if ('error' in matcher) return matcher;
  const publishers = await context.store.publishersByName(point, name, context.event.eventId);
  return { publishers };
}

/**
 * Pulls the scan JSON out of the model text. A missing or broken object becomes
 * a safe empty result, matching the plain runner. A parsed object with no verdict
 * stays `unknown`.
 */
function parseScanJson(content: string): LLMScanResult {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return emptyScan('safe');
  try {
    const parsed: unknown = JSON.parse(content.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyScan('safe');
    const record = parsed as Record<string, unknown>;
    return {
      contentVerdict: readContentVerdict(record.contentVerdict, 'unknown'),
      possibleTags: tagScores(record.possibleTags),
      possiblePublishers: possiblePublishers(record.possiblePublishers),
      possibleDuplicates: possibleDuplicates(record.possibleDuplicates),
      summary: typeof record.summary === 'string' ? record.summary : '',
      language: typeof record.language === 'string' ? record.language : '',
    };
  } catch {
    return emptyScan('safe');
  }
}

/** Empty scan used when the model text has no JSON object. */
function emptyScan(contentVerdict: LLMScanResult['contentVerdict']): LLMScanResult {
  return { contentVerdict, possibleTags: [], possiblePublishers: [], possibleDuplicates: [], summary: '', language: '' };
}

/** Keeps only the three verdicts the scan stores. Anything else uses `fallback`. */
function readContentVerdict(
  value: unknown,
  fallback: LLMScanResult['contentVerdict'],
): LLMScanResult['contentVerdict'] {
  if (value === 'spam' || value === 'harmful' || value === 'safe' || value === 'unknown') return value;
  return fallback;
}

/** Tag scores the catalog matcher understands. Rows that are not objects are dropped. */
function tagScores(value: unknown): LLMScanResult['possibleTags'] {
  if (!Array.isArray(value)) return [];
  const scores: LLMScanResult['possibleTags'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const id = 'id' in item ? item.id : undefined;
    const score = 'score' in item ? item.score : undefined;
    if ((typeof id !== 'string' && typeof id !== 'number') || typeof score !== 'number') continue;
    scores.push({ id: String(id), score });
  }
  return scores;
}

function possiblePublishers(value: unknown): LLMScanResult['possiblePublishers'] {
  if (!Array.isArray(value)) return [];
  const publishers: LLMScanResult['possiblePublishers'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const publisherId = 'publisherId' in item ? item.publisherId : undefined;
    const rank = 'rank' in item ? item.rank : undefined;
    if ((typeof publisherId !== 'string' && typeof publisherId !== 'number') || typeof rank !== 'number') continue;
    publishers.push({ publisherId: String(publisherId), rank });
  }
  return publishers;
}

function possibleDuplicates(value: unknown): LLMScanResult['possibleDuplicates'] {
  if (!Array.isArray(value)) return [];
  const duplicates: LLMScanResult['possibleDuplicates'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const eventId = 'eventId' in item ? item.eventId : undefined;
    const rank = 'rank' in item ? item.rank : undefined;
    const occasionRank = 'occasionRank' in item ? item.occasionRank : undefined;
    if ((typeof eventId !== 'string' && typeof eventId !== 'number') || typeof rank !== 'number') continue;
    duplicates.push({ eventId: String(eventId), rank, occasionRank });
  }
  return duplicates;
}

/**
 * Cache key for one model answer. Place and start are included because the tools
 * depend on them. The event id is not, so two copies of the same listing share a call.
 */
function scanCacheKey(event: TagMatchInput & Pick<ScanInput, 'startsAt' | 'location'>): string {
  const point = event.location ? `${event.location.lat},${event.location.lng}` : '';
  return [event.title, event.description ?? '', event.venue ?? '', event.startsAt, point].join('\n');
}

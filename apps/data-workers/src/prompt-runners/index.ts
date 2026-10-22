import type { IngestStore } from '../store';
import type { PromptRunner } from './types';
import { createOllamaWithToolsPromptRunner } from './chatwithtools';

export type {
  ChosenPublisher,
  PossibleDuplicateMatch,
  PromptRunner,
  PublisherLookup,
  PublisherLookupOutcome,
  PublisherLookupInput,
  ScanInput,
  ScanOutcome,
} from './types';
export { createOllamaPromptRunner } from './ollama';
export { createOllamaWithToolsPromptRunner } from './chatwithtools';
export { parseStoredScanOutput, scanOutcomeFromContent } from './chatwithtools';
export type { OllamaWithToolsRunnerOptions } from './chatwithtools';

/**
 * The scan job's chat runner. `CHAT_PROVIDER=chatgpt` uses `OPENAI_API_KEY`.
 * `CHAT_PROVIDER=claude` uses `ANTHROPIC_API_KEY`. Unset stays on local Ollama.
 * `CHAT_PROVIDER=runpod` is handled by the scan job, which points this runner at the pod.
 */
export function promptRunnerFromEnv(
  store: IngestStore,
  config: Record<string, unknown> = {},
): PromptRunner {
  return createOllamaWithToolsPromptRunner(store, { config });
}

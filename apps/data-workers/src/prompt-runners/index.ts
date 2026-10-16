import { createOllamaPromptRunner } from './ollama';
import type { IngestStore } from '../store';
import type { PromptRunner } from './types';

export type { ChosenPublisher, PossibleDuplicateMatch, PromptRunner, ScanInput, ScanOutcome } from './types';
export { createOllamaPromptRunner } from './ollama';

export function promptRunnerFromEnv(
  store: IngestStore,
  config: Record<string, unknown> = {},
): PromptRunner {
  return createOllamaPromptRunner(store, { config });
}

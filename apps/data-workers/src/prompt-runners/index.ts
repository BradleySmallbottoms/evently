import { createOllamaPromptRunner } from './ollama';
import type { IngestStore } from '../store';
import type { PromptRunner } from './types';
import { createOllamaWithToolsPromptRunner } from './ollamawithtools';

export type { ChosenPublisher, PossibleDuplicateMatch, PromptRunner, ScanInput, ScanOutcome } from './types';
export { createOllamaPromptRunner } from './ollama';
export { createOllamaWithToolsPromptRunner } from './ollamawithtools';
export type { OllamaWithToolsRunnerOptions } from './ollamawithtools';

export function promptRunnerFromEnv(
  store: IngestStore,
  config: Record<string, unknown> = {},
): PromptRunner {
  return createOllamaWithToolsPromptRunner(store, { config });
}

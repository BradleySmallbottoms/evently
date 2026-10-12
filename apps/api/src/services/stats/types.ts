import type { StatEntry, StatsSourceType } from '@local-events/contracts';
import type { StatMutation } from '@local-events/domain';

export type StatsErrorCode = 'unauthorized' | 'not_found' | 'forbidden' | 'bad_request';

export class StatsError extends Error {
  constructor(readonly code: StatsErrorCode) {
    super(code);
    this.name = 'StatsError';
  }
}

export type StatsServices = {
  /** Public/self read. Missing keys are omitted (treat as 0). */
  getStats: (input: {
    sourceType: StatsSourceType;
    sourceId: string;
    keys: string[];
    sessionToken?: string;
  }) => Promise<StatEntry[]>;
  /** Worker-only mutations. Body keys are applied as-is (no bucket expansion). */
  putStats: (input: {
    sourceType: StatsSourceType;
    sourceId: string;
    mutations: StatMutation[];
    workerToken: string | undefined;
  }) => Promise<StatEntry[]>;
};
